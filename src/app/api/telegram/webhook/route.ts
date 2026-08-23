import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEnv } from "@/lib/env";
import { toIntake, type Intake } from "@/lib/telegram/intake";
import { claimUpdate, isDuplicateKeyError } from "@/lib/idempotency";
import { sendMessage, editMessageText, editMessageReplyMarkup, answerCallbackQuery } from "@/lib/telegram/client";
import {
  parseCallbackData,
  buildExpenseKeyboard,
  buildCategoryKeyboard,
  buildDeleteConfirmKeyboard,
} from "@/lib/telegram/callbacks";
import { FALLBACK_CATEGORY, parseMessage } from "@/lib/ai/parse";
import { getAiProvider } from "@/lib/ai/provider";
import { todayInBuenosAires } from "@/lib/ai/normalize";
import type { GastoResult, CorreccionPatch } from "@/lib/ai/types";
import { buildConfirmation, describeChanges, isAnomalous, resolveCard } from "@/lib/expenses/create-from-bot";
import {
  resolveCorrectionTarget,
  applyCorrection,
  deleteExpenseWithInstallments,
  type CorrectableExpense,
  type CorrectedExpense,
} from "@/lib/expenses/correct";
import { getHouseholdUserIds } from "@/lib/household";
import { buildInstallments } from "@/lib/expenses/installments";
import { canEditViaBot } from "@/lib/visibility";

const OK = () => NextResponse.json({ ok: true });
const UNAUTHORIZED = () => NextResponse.json({ error: "No autorizado" }, { status: 401 });

/**
 * La UNICA respuesta no-200 que no es un rechazo de autenticacion, y es
 * deliberada. Ver la Region 1 en el comentario de `POST`.
 */
const REINTENTAR = () =>
  NextResponse.json({ error: "No se pudo registrar el update, reintentar" }, { status: 503 });

const INSTRUCCIONES_VINCULACION =
  "Hola! Para usarme tenes que vincular tu cuenta.\n" +
  "1. Entra a la web y abri el Dashboard.\n" +
  "2. Toca «Vincular Telegram»: te va a dar un codigo.\n" +
  "3. Mandame aca <code>/start</code> seguido de ese codigo.\n\n" +
  "Despues me escribis el gasto en un mensaje, por ejemplo: " +
  "<i>12 lucas panaderia</i>.";

type Registered = {
  expenseId: string;
  amount: number;
  /** Lo necesita el teclado: el boton de scope ofrece ir al OPUESTO. */
  scope: string;
  confirmation: string;
};

/**
 * `/start`, con o sin codigo. Devuelve true si el update era un `/start` y ya
 * quedo contestado.
 *
 * El `/start` PELADO importa: es exactamente lo que manda el boton "Start" de
 * Telegram, o sea la primerisima interaccion de cualquier persona con el bot.
 * Antes no matcheaba el regex, caia en la whitelist, no encontraba usuario y
 * se respondia 200 sin decir nada: la persona veia silencio y no tenia forma
 * de saber que le falta un codigo.
 */
async function handleStart(intake: Intake, householdUserIds: string[]): Promise<boolean> {
  const match = intake.text?.match(/^\/start(?:\s+(\S+))?\s*$/i);
  if (!match) return false;

  const code = match[1]?.toLowerCase();
  if (!code) {
    await sendMessage(intake.chatId, INSTRUCCIONES_VINCULACION);
    return true;
  }

  if (!/^[a-f0-9]{8}$/.test(code)) {
    await sendMessage(
      intake.chatId,
      "Ese codigo no tiene la forma que espero (8 caracteres).\n\n" + INSTRUCCIONES_VINCULACION
    );
    return true;
  }

  const user = await prisma.user.findFirst({
    where: { id: { in: householdUserIds }, telegramLinkCode: code },
  });
  if (!user) {
    await sendMessage(intake.chatId, "Ese codigo no es valido o ya se uso.");
    return true;
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
      await sendMessage(intake.chatId, "Este chat de Telegram ya esta vinculado a otra cuenta.");
      return true;
    }
    throw error;
  }

  await sendMessage(intake.chatId, `Listo ${user.name}, ya podes mandarme gastos.`);
  return true;
}

/**
 * Carga el contexto, parsea, y despacha al camino que corresponda.
 *
 * Todo lo que pasa aca adentro menos las escrituras de `registerExpense` y
 * `applyTextCorrection` vive en la Region 2: si algo tira antes, NADA quedo
 * escrito y es seguro pedir un reenvio.
 */
async function handleTextMessage(
  intake: Intake & { text: string },
  user: { id: string; name: string },
  householdUserIds: string[]
): Promise<Registered | null> {
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

  if (parsed.intent === "consulta_no_soportada") {
    await sendMessage(
      intake.chatId,
      "Todavia no puedo responder preguntas sobre los gastos. Mira el dashboard en la web."
    );
    return null;
  }

  if (parsed.intent === "correccion") {
    return applyTextCorrection(intake, user, parsed.patch, categories, members);
  }

  if (parsed.intent !== "gasto") {
    await sendMessage(intake.chatId, `No lo pude registrar: ${parsed.reason}`);
    return null;
  }

  return registerExpense(intake, user, parsed, categories, members);
}

/**
 * Una correccion por texto libre. Devuelve un `Registered` como el alta, asi
 * que la Region 3 la confirma con el mismo codigo: un mensaje nuevo con
 * teclado, y el puntero `botChatId`/`botMessageId` movido a ese mensaje.
 *
 * **La confirmacion vieja NO se reescribe.** Mandar un mensaje nuevo la deja
 * con el texto de antes, que es como funciona cualquier chat: los mensajes
 * viejos son viejos. Sus botones siguen siendo seguros porque llevan el
 * objetivo explicito (ver `src/lib/telegram/callbacks.ts`): el boton de scope
 * de un mensaje viejo escribe el valor que ese boton dice, no una inversion
 * del estado actual. Y el puntero se mueve al mensaje nuevo, asi que responder
 * al ultimo es lo que resuelve.
 */
async function applyTextCorrection(
  intake: Intake & { text: string },
  user: { id: string; name: string },
  patch: CorreccionPatch,
  categories: { id: string; name: string }[],
  members: { id: string; name: string }[]
): Promise<Registered | null> {
  const target = await resolveCorrectionTarget(
    prisma,
    user.id,
    intake.chatId,
    intake.replyToMessageId
  );

  if (!target.expense) {
    await sendMessage(
      intake.chatId,
      target.reason === "reply_desconocido"
        ? // El puntero (botChatId/botMessageId) se mueve al mensaje nuevo
          // despues de cada correccion. Si la persona responde al mensaje
          // VIEJO, el gasto puede existir perfectamente — lo unico que paso es
          // que el puntero ya no apunta ahi. "No encuentro el gasto" sugeria
          // que se habia perdido algo, cuando lo que hay que hacer es
          // responder a la confirmacion mas reciente.
          "No encuentro el gasto de ese mensaje. Si ya lo corregiste, responde a mi ultima confirmacion de ese gasto."
        : "Todavia no cargaste ningun gasto, asi que no tengo nada que corregir."
    );
    return null;
  }

  const expense = target.expense;

  if (!canEditViaBot(expense, user.id)) {
    await sendMessage(
      intake.chatId,
      "Ese gasto no lo pagaste ni lo cargaste vos, asi que no lo puedo cambiar."
    );
    return null;
  }

  const corrected = await applyCorrection(prisma, expense, patch, categories);

  return {
    expenseId: expense.id,
    amount: corrected.amount,
    scope: corrected.scope,
    confirmation: await buildCorrectedConfirmation(
      expense,
      expense.userId,
      corrected,
      categories,
      members
    ),
  };
}

/**
 * El texto de confirmacion de un gasto ya corregido.
 *
 * Se relee la tarjeta con una consulta propia en vez de arrastrarla: el tipo
 * `CorrectableExpense` no la declara, y omitirla del mensaje diria que el gasto
 * no tiene tarjeta cuando si la tiene — justo el dato que decide si entra en la
 * deuda de tarjetas del dashboard.
 *
 * Recibe el estado `antes` (el `CorrectableExpense` de ANTES de aplicar el
 * patch) para armar `cambios` con `describeChanges`. Ver el comentario de esa
 * funcion: es la unica forma en que una correccion aplicada al gasto
 * equivocado se puede ver y desarmar a mano.
 */
async function buildCorrectedConfirmation(
  antes: CorrectableExpense,
  payerId: string,
  corrected: CorrectedExpense,
  categories: { id: string; name: string }[],
  members: { id: string; name: string }[]
): Promise<string> {
  const expenseId = antes.id;
  const [average, cardRow] = await Promise.all([
    prisma.expense.aggregate({
      where: { categoryId: corrected.categoryId },
      _avg: { amount: true },
    }),
    prisma.expense.findFirst({
      where: { id: expenseId },
      select: { creditCard: { select: { name: true } } },
    }),
  ]);

  const nombreCategoria = (id: string) => categories.find((c) => c.id === id)?.name ?? "-";
  const cambios = describeChanges(
    {
      amount: antes.amount,
      description: antes.description,
      date: antes.date,
      scope: antes.scope,
      categoryName: nombreCategoria(antes.categoryId),
    },
    {
      amount: corrected.amount,
      description: corrected.description,
      date: corrected.date,
      scope: corrected.scope,
      categoryName: nombreCategoria(corrected.categoryId),
    }
  );

  return buildConfirmation({
    amount: corrected.amount,
    description: corrected.description,
    categoryName: nombreCategoria(corrected.categoryId),
    scope: corrected.scope,
    payerName: members.find((m) => m.id === payerId)?.name ?? "-",
    date: corrected.date,
    cambios,
    anomalous: isAnomalous(corrected.amount, average._avg.amount),
    cardName: cardRow?.creditCard?.name ?? null,
    corregido: true,
  });
}

/**
 * Parsea el texto y crea el Expense. Devuelve `null` cuando el update ya quedo
 * contestado sin crear nada (no era un gasto, falta la categoria de respaldo).
 *
 * Todo lo que hace esta funcion menos la ultima escritura vive en la Region 2:
 * si algo tira antes del `expense.create`, NADA quedo escrito y es seguro
 * pedirle a la persona que reenvie.
 */
async function registerExpense(
  intake: Intake & { text: string },
  user: { id: string; name: string },
  parsed: GastoResult,
  categories: { id: string; name: string }[],
  members: { id: string; name: string }[]
): Promise<Registered | null> {
  // `parseMessage` garantiza que categoryName es una de las categorias que se
  // le pasaron O el literal FALLBACK_CATEGORY. El caso que el `!` de antes no
  // cubria es que la fila de respaldo NO EXISTA: `find` devuelve undefined,
  // `category.id` tira, el catch de afuera contesta 200 y el usuario no recibe
  // NADA — con el update_id ya quemado, asi que ni el reintento de Telegram lo
  // salva. Es alcanzable hoy: DELETE /api/categories/[id] borra cualquier
  // categoria sin gastos. Ahora la resolucion no puede tirar y, si falla, se
  // le contesta al usuario.
  const category =
    categories.find((c) => c.name === parsed.categoryName) ??
    categories.find((c) => c.name === FALLBACK_CATEGORY);

  if (!category) {
    // Cuando la IA devuelve una categoria que no existe, parse.ts ya la
    // reemplazo por FALLBACK_CATEGORY, asi que nombrar las dos seria decir dos
    // veces la misma: lo unico que falta es la fila de respaldo.
    const detalle =
      parsed.categoryName === FALLBACK_CATEGORY
        ? `no existe la categoria de respaldo "${FALLBACK_CATEGORY}"`
        : `no encontre la categoria "${parsed.categoryName}" ni la de respaldo "${FALLBACK_CATEGORY}"`;
    console.error(`El gasto no se pudo registrar: ${detalle}.`);
    await sendMessage(
      intake.chatId,
      `No lo pude registrar: ${detalle}. Creala en la web y proba de nuevo.`
    );
    return null;
  }

  const payer =
    (parsed.payerName &&
      members.find((m) => m.name.toLowerCase() === parsed.payerName!.toLowerCase())) ||
    user;

  // `parsed.cardName` se extraia y se validaba en parse.ts y despues se
  // descartaba en silencio: NINGUN gasto cargado por el bot quedaba con
  // creditCardId, asi que "super 45.300 con la visa en 3 cuotas" salia de la
  // deuda de tarjetas del dashboard (stats filtra por creditCardId != null),
  // de la pagina de tarjetas y de /api/credit-cards/[id]/pending. Las tarjetas
  // son POR PERSONA, asi que se resuelve contra las del PAGADOR.
  const [average, payerCards] = await Promise.all([
    prisma.expense.aggregate({
      where: { categoryId: category.id },
      _avg: { amount: true },
    }),
    prisma.creditCard.findMany({
      where: { userId: payer.id },
      select: { id: true, name: true },
    }),
  ]);

  const card = resolveCard(parsed.cardName, payerCards);
  // Si dijo una tarjeta y no matcheo ninguna, el gasto se guarda sin tarjeta
  // pero la confirmacion lo avisa: un silencio aca deja la compra fuera de la
  // deuda de tarjetas sin que nadie se entere.
  const unmatchedCardName = parsed.cardName && !card ? parsed.cardName : null;

  // ─── FIN DE LA REGION 2 ──────────────────────────────────────────────────
  // Esta es la unica escritura de gasto del flujo. Desde aca para abajo el
  // registro financiero existe y NO se le puede pedir a la persona que
  // reenvie: el reenvio trae un update_id nuevo, que ProcessedUpdate no
  // deduplica, y duplicaria el gasto.
  const expense = await prisma.expense.create({
    data: {
      amount: parsed.amount,
      description: parsed.description,
      date: parsed.date,
      categoryId: category.id,
      creditCardId: card?.id ?? null,
      userId: payer.id,
      createdById: user.id,
      scope: parsed.scope,
      source: "bot",
      totalInstallments: parsed.installments,
      installments: parsed.installments
        ? { create: buildInstallments(parsed.date, parsed.amount, parsed.installments) }
        : undefined,
    },
  });

  return {
    expenseId: expense.id,
    amount: parsed.amount,
    scope: parsed.scope,
    confirmation: buildConfirmation({
      amount: parsed.amount,
      description: parsed.description,
      categoryName: parsed.categoryName,
      scope: parsed.scope,
      payerName: payer.name,
      date: parsed.date,
      anomalous: isAnomalous(parsed.amount, average._avg.amount),
      cardName: card?.name ?? null,
      unmatchedCardName,
    }),
  };
}

/**
 * Un tap de boton. Maneja TODOS sus errores adentro y nunca tira: el catch de
 * la Region 2 le pediria a la persona que "reenvie el mensaje", y no hay
 * mensaje que reenviar — hay un boton que se quedo girando.
 *
 * Siempre contesta el callback_query, en todos los caminos, incluido el de
 * error: sin eso Telegram deja el boton en estado de carga y la persona no
 * sabe si paso algo.
 */
async function handleCallback(
  intake: Intake,
  user: { id: string; name: string },
  householdUserIds: string[]
): Promise<void> {
  const acusar = (text?: string) =>
    intake.callbackQueryId ? answerCallbackQuery(intake.callbackQueryId, text) : Promise.resolve();

  // Solo para el log del catch: `action` es un `const` DENTRO del try (mas
  // abajo) para que el switch narrowe bien el discriminado `kind`; este
  // string aparte es lo unico que el catch necesita nombrar.
  let expenseIdParaLog: string | undefined;

  // Los case de scope, category y deleteConfirm escriben ANTES de reescribir el
  // mensaje. Si falla el `edit*`, el cambio YA esta en la base: decirle a la
  // persona "no pude aplicar el cambio" seria mentirle, y en el caso del
  // borrado seria mentirle sobre algo irreversible. Se marca antes de escribir.
  let yaEscribio = false;

  try {
    // Un dato invalido no puede llegar a Prisma: un ObjectId mal formado hace
    // tirar a `findFirst`, y eso es un camino de error entero por nada.
    const action = parseCallbackData(intake.callbackData);
    if (!action) {
      await acusar("No entiendo ese boton.");
      return;
    }
    expenseIdParaLog = action.expenseId;

    // La puerta de la edicion por bot es `canEditViaBot`, y es la UNICA: haber
    // pagado el gasto o haberlo cargado. Deliberadamente NO se filtra tambien
    // por `visibleExpensesWhere`.
    //
    // Poner la regla de lectura como precondicion de la edicion cancela la
    // Regla de Dominio 5 en el caso exacto que la motiva: un gasto personal
    // del OTRO que yo cargue (Leandro manda "vir se compro unas zapatillas")
    // no pasa el filtro de visibilidad de Leandro, asi que su propia
    // confirmacion le contestaria "ese gasto ya no existe" sobre un gasto que
    // el acaba de cargar — y que si puede corregir respondiendole por texto,
    // porque ese camino no filtra por visibilidad. El mismo mensaje se
    // comportaria distinto segun se toque un boton o se le conteste.
    //
    // Y no se pierde nada de seguridad: `canEditViaBot` es ESTRICTAMENTE mas
    // fuerte que la visibilidad para un tap fabricado. Un gasto personal del
    // otro, pagado y cargado por el otro, falla sus dos condiciones.
    const expense = await prisma.expense.findFirst({
      where: { id: action.expenseId },
    });
    if (!expense) {
      await acusar("Ese gasto ya no existe.");
      return;
    }

    if (!canEditViaBot(expense, user.id)) {
      await acusar("Ese gasto no lo pagaste ni lo cargaste vos.");
      return;
    }

    // Las necesitan el submenu de categorias y la confirmacion reescrita.
    const [categories, members] = await Promise.all([
      prisma.category.findMany({ select: { id: true, name: true } }),
      prisma.user.findMany({
        where: { id: { in: householdUserIds } },
        select: { id: true, name: true },
      }),
    ]);

    switch (action.kind) {
      case "categoryMenu": {
        if (intake.callbackMessageId) {
          await editMessageReplyMarkup(
            intake.chatId,
            intake.callbackMessageId,
            buildCategoryKeyboard(action.expenseId, categories)
          );
        }
        await acusar();
        break;
      }

      case "cancel": {
        // Vuelta atras tanto del submenu de categorias como del pedido de
        // confirmacion de borrado.
        if (intake.callbackMessageId) {
          await editMessageReplyMarkup(
            intake.chatId,
            intake.callbackMessageId,
            buildExpenseKeyboard(action.expenseId, expense.scope)
          );
        }
        await acusar();
        break;
      }

      case "deleteAsk": {
        if (intake.callbackMessageId) {
          await editMessageReplyMarkup(
            intake.chatId,
            intake.callbackMessageId,
            buildDeleteConfirmKeyboard(action.expenseId)
          );
        }
        await acusar("Seguro que lo borro?");
        break;
      }

      case "scope": {
        yaEscribio = true;
        const corrected = await applyCorrection(prisma, expense, { scope: action.scope }, categories);
        if (intake.callbackMessageId) {
          const confirmation = await buildCorrectedConfirmation(
            expense,
            expense.userId,
            corrected,
            categories,
            members
          );
          await editMessageText(
            intake.chatId,
            intake.callbackMessageId,
            confirmation,
            buildExpenseKeyboard(action.expenseId, corrected.scope)
          );
        }
        await acusar(`Ahora es ${action.scope}.`);
        break;
      }

      case "category": {
        // Puede no existir mas: una categoria borrada entre que se mando el
        // teclado y se toco el boton.
        const category = categories.find((c) => c.id === action.categoryId);
        if (!category) {
          await acusar("Esa categoria ya no existe.");
          break;
        }

        yaEscribio = true;
        const corrected = await applyCorrection(
          prisma,
          expense,
          { categoryName: category.name },
          categories
        );
        if (intake.callbackMessageId) {
          const confirmation = await buildCorrectedConfirmation(
            expense,
            expense.userId,
            corrected,
            categories,
            members
          );
          await editMessageText(
            intake.chatId,
            intake.callbackMessageId,
            confirmation,
            buildExpenseKeyboard(action.expenseId, corrected.scope)
          );
        }
        await acusar(category.name);
        break;
      }

      case "deleteConfirm": {
        yaEscribio = true;
        await deleteExpenseWithInstallments(prisma, action.expenseId);
        // Sin teclado: un teclado sobre un gasto inexistente solo puede dar
        // errores.
        if (intake.callbackMessageId) {
          await editMessageText(
            intake.chatId,
            intake.callbackMessageId,
            `🗑 Borrado: ${expense.description}`
          );
        }
        await acusar("Borrado.");
        break;
      }
    }
  } catch (error) {
    console.error(
      yaEscribio
        ? `CAMBIO APLICADO SIN CONFIRMAR: expenseId=${expenseIdParaLog} ` +
            `chatId=${intake.chatId} — la escritura en la base pudo haberse ` +
            "aplicado y fallo lo que viene despues (reescribir el mensaje o " +
            "acusar el callback). El mensaje del chat puede estar mostrando el " +
            "estado viejo."
        : `Error procesando el callback expenseId=${expenseIdParaLog} chatId=${intake.chatId} — ` +
            "no se escribio nada.",
      error
    );
    try {
      await acusar(
        yaEscribio
          ? "El cambio se aplico, pero no pude actualizar el mensaje. Mira el dashboard."
          : "No pude aplicar el cambio por un error de mi lado."
      );
    } catch (avisoError) {
      // El catch del acuse va aparte y solo loguea: si falla el acuse no
      // queda nada mejor que hacer.
      console.error(
        `Tampoco se pudo acusar el callback_query de expenseId=${expenseIdParaLog} ` +
          `chatId=${intake.chatId}.`,
        avisoError
      );
    }
  }
}

/**
 * El manejo de errores esta partido en TRES REGIONES, porque la respuesta
 * correcta es distinta en cada una. Un unico catch que devuelve 200 (lo que
 * habia antes) convierte cualquier falla en silencio: la persona no ve nada,
 * reenvia el mensaje, y el reenvio trae un **update_id NUEVO** que
 * ProcessedUpdate no puede deduplicar. Un mensaje perdido se vuelve un gasto
 * duplicado: exactamente la falla que todo el diseño evita, por otra puerta.
 *
 * **Region 1 — `claimUpdate` tira.** Un error transitorio de Mongo. Es el
 * unico punto donde el reintento es DEMOSTRABLEMENTE seguro: o no se escribio
 * nada y el reintento entra limpio, o la fila se escribio sin que llegaramos a
 * contestar y el reintento choca con P2002 y se descarta como duplicado. Se
 * devuelve 503 y el reintento lo hace Telegram. Es la excepcion deliberada a
 * "siempre 200": aca romper la regla la mejora.
 *
 * **Region 2 — entre el claim y `expense.create`.** Todavia no se escribio
 * ningun gasto, asi que es seguro decirle a la persona que reenvie. Se le
 * avisa con un sendMessage y se contesta 200 (un reintento de Telegram aca
 * repetiria el trabajo de la IA sin necesidad, y la persona ya sabe).
 *
 * **Region 3 — despues de `expense.create`.** El gasto YA existe. Aca pedirle
 * que reenvie CAUSARIA el duplicado, asi que no se le pide nada: se loguea y
 * se contesta 200. El log es la unica mitigacion de este camino, y por eso son
 * dos catches separados — uno para el sendMessage y otro para el update de
 * botChatId/botMessageId. Con un solo catch, el mensaje "el usuario no recibio
 * la confirmacion" MENTIA cuando el sendMessage habia salido bien y solo fallo
 * el update posterior, y mandaba al operador a buscar el problema equivocado.
 */
export async function POST(req: Request) {
  let secret: string;
  try {
    secret = requireEnv("TELEGRAM_WEBHOOK_SECRET");
  } catch (error) {
    // Sin el secret no podemos autenticar el request: no es distinto de un
    // secret invalido a los ojos del invariante "solo 401 no es 200", pero
    // si es distinto en causa — se loguea fuerte para diferenciarlo de un
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

  // ─── Region 1: el claim de idempotencia ──────────────────────────────────
  let claimed: boolean;
  try {
    claimed = await claimUpdate(prisma, intake.updateId);
  } catch (error) {
    console.error(
      `No se pudo reclamar el update_id=${intake.updateId} (error transitorio de la base). ` +
        "Se responde 503 a proposito para que Telegram reintente: el reintento es seguro, " +
        "porque o no se escribio nada o choca con P2002 y se descarta.",
      error
    );
    return REINTENTAR();
  }
  if (!claimed) return OK();

  // ─── Region 2: nada escrito todavia, se puede pedir un reenvio ───────────
  let registered: Registered | null;
  try {
    // Los miembros del hogar: acota el /start, la whitelist y la lista de
    // pagadores que se le pasa a la IA. Ver src/lib/household.ts.
    const householdUserIds = await getHouseholdUserIds();

    if (await handleStart(intake, householdUserIds)) return OK();

    // Whitelist: solo los chats vinculados A UN MIEMBRO DEL HOGAR. El resto se
    // ignora en silencio. El filtro por miembro es defensa en profundidad: si
    // quedara una cuenta vieja vinculada y su email saliera de la allowlist,
    // deja de poder cargar gastos sin necesidad de desvincular el chat a mano.
    const user = await prisma.user.findFirst({
      where: { id: { in: householdUserIds }, telegramChatId: intake.chatId },
    });
    if (!user) return OK();

    // Un tap de boton. Se maneja entero aca adentro y no sigue al flujo de
    // texto: un callback no tiene texto que parsear, y el mensaje de error de
    // la Region 2 ("reenviame el mensaje") no tiene sentido para un boton.
    //
    // `!== null`, no truthiness: un `callback_data` de string vacio (nuestros
    // teclados nunca lo mandan, pero un update fabricado si podria) es un
    // callback igual, y con truthiness caia al camino de texto — "Por ahora
    // solo entiendo texto" sobre un boton que se queda girando. `""` sigue
    // siendo un callback: `parseCallbackData` lo procesa (devuelve `null`
    // porque no matchea ningun formato conocido) y el camino de abajo contesta
    // "No entiendo ese boton", que es lo honesto.
    if (intake.callbackData !== null) {
      await handleCallback(intake, user, householdUserIds);
      return OK();
    }

    if (!intake.text) {
      await sendMessage(intake.chatId, "Por ahora solo entiendo texto. Las fotos llegan pronto.");
      return OK();
    }

    registered = await handleTextMessage({ ...intake, text: intake.text }, user, householdUserIds);
  } catch (error) {
    console.error(
      `Error procesando el update_id=${intake.updateId} ANTES de crear el gasto: no se ` +
        "escribio nada, se le avisa a la persona para que reenvie.",
      error
    );
    try {
      await sendMessage(
        intake.chatId,
        "No pude registrar el gasto por un error de mi lado. No quedo guardado nada: " +
          "reenviame el mensaje."
      );
    } catch (avisoError) {
      // Si tampoco se puede avisar, no queda nada mejor que el log: la persona
      // va a reenviar por su cuenta, y no hay gasto que duplicar.
      console.error(`Tampoco se pudo avisar del error al chatId=${intake.chatId}.`, avisoError);
    }
    return OK();
  }

  // El update ya quedo contestado sin crear ningun gasto.
  if (!registered) return OK();

  // ─── Region 3: el gasto YA existe, pedir un reenvio duplicaria ───────────
  let sentMessageId: string | null = null;
  try {
    const sent = await sendMessage(
      intake.chatId,
      registered.confirmation,
      buildExpenseKeyboard(registered.expenseId, registered.scope)
    );
    sentMessageId = String(sent.message_id);
  } catch (error) {
    // El estado "guardado pero sin confirmar" no puede ser indistinguible de
    // un exito en los logs: el mensaje nombra el expenseId, el monto y el
    // chatId para que un "no me llego nada" se resuelva mirando el log en vez
    // de adivinando si el gasto existe.
    console.error(
      `GASTO GUARDADO SIN CONFIRMAR: expenseId=${registered.expenseId} ` +
        `amount=${registered.amount} chatId=${intake.chatId} — fallo el sendMessage. El ` +
        "Expense ya esta en la base y el usuario NO recibio la confirmacion; si reenvia, " +
        "el gasto se duplica.",
      error
    );
  }

  if (sentMessageId) {
    try {
      await prisma.expense.update({
        where: { id: registered.expenseId },
        data: { botChatId: intake.chatId, botMessageId: sentMessageId },
      });
    } catch (error) {
      // Distinto del de arriba a proposito: aca la confirmacion SI llego. Lo
      // unico que falta es el puntero al mensaje, o sea que no se va a poder
      // corregir este gasto por reply. Decir "el usuario no recibio la
      // confirmacion" aca seria mentira, y manda a buscar el problema
      // equivocado.
      //
      // Desde este bloque el puntero pesa mas de lo que pesaba: antes solo
      // impedia corregir por reply. Ahora `resolveCorrectionTarget` lo usa
      // para resolver el reply SIN AMBIGUEDAD (busca el gasto por
      // `botChatId` + `botMessageId` exactos); sin el puntero, una
      // correccion por reply a este mensaje cae al camino de respaldo ("el
      // ultimo gasto que esa persona registro"), que puede ser OTRO gasto.
      // El log lo dice para que quede claro que no es solo "no se puede
      // corregir por reply": es "el reply puede corregir el gasto
      // equivocado".
      console.error(
        "GASTO GUARDADO Y CONFIRMADO, SIN PUNTERO AL MENSAJE: " +
          `expenseId=${registered.expenseId} chatId=${intake.chatId} ` +
          `messageId=${sentMessageId} — el usuario SI recibio la confirmacion; fallo solo ` +
          "el update de botChatId/botMessageId. Un reply a este mensaje NO va a resolver a " +
          "este gasto: cae al camino de respaldo (el ultimo gasto que la persona registro), " +
          "que puede ser otro.",
        error
      );
    }
  }

  return OK();
}
