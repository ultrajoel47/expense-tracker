import { requireEnv } from "@/lib/env";

export type TelegramMessage = { message_id: number; chat: { id: number } };

/**
 * Base de la Bot API. Se sobreescribe con `TELEGRAM_API_BASE_URL` **solo para
 * pruebas locales**, apuntando a un mock que registra los mensajes que el bot
 * manda: sin eso no hay forma de verificar el texto de una confirmacion ni los
 * caminos de error del webhook sin un chat de Telegram real. En produccion la
 * variable se deja sin definir.
 */
const API_BASE = process.env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org";

function apiUrl(method: string) {
  return `${API_BASE}/bot${requireEnv("TELEGRAM_BOT_TOKEN")}/${method}`;
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: unknown
): Promise<TelegramMessage> {
  const res = await fetch(apiUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Telegram sendMessage fallo: ${JSON.stringify(json)}`);
  }
  return json.result as TelegramMessage;
}
