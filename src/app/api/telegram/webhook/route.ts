import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEnv } from "@/lib/env";
import { toIntake } from "@/lib/telegram/intake";
import { claimUpdate, isDuplicateKeyError } from "@/lib/idempotency";
import { sendMessage } from "@/lib/telegram/client";

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

    // /start <codigo>: vincula el chat con el usuario
    const startMatch = intake.text?.match(/^\/start\s+([a-f0-9]{8})$/i);
    if (startMatch) {
      const user = await prisma.user.findFirst({
        where: { telegramLinkCode: startMatch[1].toLowerCase() },
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

    // Whitelist: solo los chats vinculados. El resto se ignora en silencio.
    const user = await prisma.user.findFirst({
      where: { telegramChatId: intake.chatId },
    });
    if (!user) return OK();

    await sendMessage(intake.chatId, "Te escucho. (el parser llega en la tarea 10)");
    return OK();
  } catch (error) {
    console.error("Error procesando update de Telegram", error);
    return OK();
  }
}
