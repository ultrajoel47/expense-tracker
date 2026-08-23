import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEnv } from "@/lib/env";
import { toIntake } from "@/lib/telegram/intake";
import { claimUpdate } from "@/lib/idempotency";
import { sendMessage } from "@/lib/telegram/client";

/** Telegram reintenta ante cualquier respuesta que no sea 200. Siempre 200. */
const OK = () => NextResponse.json({ ok: true });

export async function POST(req: Request) {
  if (
    req.headers.get("x-telegram-bot-api-secret-token") !==
    requireEnv("TELEGRAM_WEBHOOK_SECRET")
  ) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let intake;
  try {
    intake = toIntake(await req.json());
  } catch {
    return OK();
  }
  if (!intake) return OK();

  if (!(await claimUpdate(prisma, intake.updateId))) return OK();

  try {
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
      await prisma.user.update({
        where: { id: user.id },
        data: { telegramChatId: intake.chatId, telegramLinkCode: null },
      });
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
