import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEnv } from "@/lib/env";
import { toIntake } from "@/lib/telegram/intake";
import { claimUpdate, isDuplicateKeyError } from "@/lib/idempotency";
import { sendMessage } from "@/lib/telegram/client";
import { FALLBACK_CATEGORY, parseMessage } from "@/lib/ai/parse";
import { getAiProvider } from "@/lib/ai/provider";
import { todayInBuenosAires } from "@/lib/ai/normalize";
import { buildConfirmation, isAnomalous } from "@/lib/expenses/create-from-bot";
import { getHouseholdUserIds } from "@/lib/household";

/** Telegram reintenta ante cualquier respuesta que no sea 200. Siempre 200. */
const OK = () => NextResponse.json({ ok: true });
const UNAUTHORIZED = () => NextResponse.json({ error: "No autorizado" }, { status: 401 });

export async function POST(req: Request) {
  let secret: string;
  try {
    secret = requireEnv("TELEGRAM_WEBHOOK_SECRET");
  } catch (error) {
    // Sin el secret no podemos autenticar el request: no es distinto de un
    // secret invalido a los ojos del invariante "solo 401 no es 200", pero
    // sí es distinto en causa — se loguea fuerte para diferenciarlo de un
    // atacante mandando tokens al azar.
    console.error("Falta configurar TELEGRAM_WEBHOOK_SECRET", error);
    return UNAUTHORIZED();
  }

  if (req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return UNAUTHORIZED();
  }

  let intake;
  try {
    intake = toIntake(await req.json());
  } catch {
    return OK();
  }
  if (!intake) return OK();

  try {
    if (!(await claimUpdate(prisma, intake.updateId))) return OK();

    // Los miembros del hogar: acota el /start, la whitelist y la lista de
    // pagadores que se le pasa a la IA. Ver src/lib/household.ts.
    const householdUserIds = await getHouseholdUserIds();

    // /start <codigo>: vincula el chat con el usuario
    const startMatch = intake.text?.match(/^\/start\s+([a-f0-9]{8})$/i);
    if (startMatch) {
      const user = await prisma.user.findFirst({
        where: { id: { in: householdUserIds }, telegramLinkCode: startMatch[1].toLowerCase() },
      });
      if (!user) {
        await sendMessage(intake.chatId, "Ese codigo no es valido o ya se uso.");
        return OK();
      }
      try {
        await prisma.user.update({
          where: { id: user.id },
          // { unset: true }, no null: telegramLinkCode tiene un indice unico
          // sparse. Un null explicito SI se indexa y colisiona entre dos
          // usuarios; un campo ausente lo ignora. Ver docs/data-models.md.
          data: { telegramChatId: intake.chatId, telegramLinkCode: { unset: true } },
        });
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          await sendMessage(
            intake.chatId,
            "Este chat de Telegram ya esta vinculado a otra cuenta."
          );
          return OK();
        }
        throw error;
      }
      await sendMessage(intake.chatId, `Listo ${user.name}, ya podes mandarme gastos.`);
      return OK();
    }

    // Whitelist: solo los chats vinculados A UN MIEMBRO DEL HOGAR. El resto se
    // ignora en silencio. El filtro por miembro es defensa en profundidad: si
    // quedara una cuenta vieja vinculada y su email saliera de la allowlist,
    // deja de poder cargar gastos sin necesidad de desvincular el chat a mano.
    const user = await prisma.user.findFirst({
      where: { id: { in: householdUserIds }, telegramChatId: intake.chatId },
    });
    if (!user) return OK();

    if (!intake.text) {
      await sendMessage(intake.chatId, "Por ahora solo entiendo texto. Las fotos llegan pronto.");
      return OK();
    }

    const [categories, members] = await Promise.all([
      prisma.category.findMany({ select: { id: true, name: true } }),
      // Solo los miembros del hogar son pagadores resolubles. Antes esto era
      // `findMany()` sin filtro: un tercero registrado aparecia en la lista
      // que se le manda a la IA y quedaba como nombre de pagador valido.
      prisma.user.findMany({
        where: { id: { in: householdUserIds } },
        select: { id: true, name: true },
      }),
    ]);

    const parsed = await parseMessage(
      intake.text,
      {
        categories: categories.map((c) => c.name),
        members,
        senderId: user.id,
        today: todayInBuenosAires(new Date()),
        aliases: [],
      },
      getAiProvider()
    );

    if (parsed.intent !== "gasto") {
      await sendMessage(intake.chatId, `No lo pude registrar: ${parsed.reason}`);
      return OK();
    }

    // `parseMessage` garantiza que categoryName es una de las categorias que
    // se le pasaron O el literal FALLBACK_CATEGORY. El caso que el `!` de
    // antes no cubria es que la fila de respaldo NO EXISTA: `find` devuelve
    // undefined, `category.id` tira, el catch de afuera contesta 200 y el
    // usuario no recibe NADA — con el update_id ya quemado, asi que ni el
    // reintento de Telegram lo salva. Es alcanzable hoy: DELETE
    // /api/categories/[id] borra cualquier categoria sin gastos. Ahora la
    // resolucion no puede tirar y, si falla, se le contesta al usuario.
    const category =
      categories.find((c) => c.name === parsed.categoryName) ??
      categories.find((c) => c.name === FALLBACK_CATEGORY);

    if (!category) {
      console.error(
        `No existe la categoria "${parsed.categoryName}" ni la de respaldo ` +
          `"${FALLBACK_CATEGORY}": el gasto no se pudo registrar.`
      );
      await sendMessage(
        intake.chatId,
        `No lo pude registrar: no encontre la categoria "${parsed.categoryName}" ni la ` +
          `categoria de respaldo "${FALLBACK_CATEGORY}". Creala en la web y probá de nuevo.`
      );
      return OK();
    }

    const payer =
      (parsed.payerName &&
        members.find((m) => m.name.toLowerCase() === parsed.payerName!.toLowerCase())) ||
      user;

    const average = await prisma.expense.aggregate({
      where: { categoryId: category.id },
      _avg: { amount: true },
    });

    const expense = await prisma.expense.create({
      data: {
        amount: parsed.amount,
        description: parsed.description,
        date: parsed.date,
        categoryId: category.id,
        userId: payer.id,
        createdById: user.id,
        scope: parsed.scope,
        source: "bot",
        totalInstallments: parsed.installments,
        installments: parsed.installments
          ? {
              create: Array.from({ length: parsed.installments }, (_, i) => {
                const due = new Date(parsed.date);
                due.setMonth(due.getMonth() + i);
                return {
                  installmentNumber: i + 1,
                  dueDate: due,
                  amount: parsed.amount / parsed.installments!,
                };
              }),
            }
          : undefined,
      },
    });

    // El Expense ya esta commiteado en este punto (arriba). Si sendMessage
    // o el update de botChatId/botMessageId fallan, el gasto queda GUARDADO
    // pero sin confirmar: no se revierte (revertir un registro financiero
    // ya guardado por un hipo de Telegram seria peor), pero tampoco se
    // reintenta aca — un reintento automatico podria mandar dos mensajes si
    // el primero en realidad llego. Lo que si hay que evitar es que este
    // estado (guardado, no confirmado) sea indistinguible de un exito en
    // los logs: el catch generico de mas abajo lo loguea como un error
    // cualquiera, y el usuario, al no ver respuesta, reenvia el mensaje con
    // un update_id NUEVO — que ProcessedUpdate no deduplica — duplicando el
    // gasto. Por eso este bloque tiene su propio catch con un mensaje
    // especifico y buscable, que nombra el expense.id, el monto y el chatId,
    // para que un "no me llego nada" se resuelva mirando el log en vez de
    // adivinando si el gasto existe.
    try {
      const sent = await sendMessage(
        intake.chatId,
        buildConfirmation({
          amount: parsed.amount,
          description: parsed.description,
          categoryName: parsed.categoryName,
          scope: parsed.scope,
          payerName: payer.name,
          date: parsed.date,
          anomalous: isAnomalous(parsed.amount, average._avg.amount),
        })
      );

      await prisma.expense.update({
        where: { id: expense.id },
        data: { botChatId: intake.chatId, botMessageId: String(sent.message_id) },
      });
    } catch (error) {
      console.error(
        `GASTO GUARDADO SIN CONFIRMAR: expenseId=${expense.id} amount=${parsed.amount} ` +
          `chatId=${intake.chatId} — sendMessage o el update posterior fallaron, el Expense ` +
          `ya esta en la base pero el usuario no recibio la confirmacion.`,
        error
      );
    }

    return OK();
  } catch (error) {
    console.error("Error procesando update de Telegram", error);
    return OK();
  }
}
