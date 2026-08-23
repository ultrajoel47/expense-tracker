import { requireEnv } from "@/lib/env";

export type TelegramMessage = { message_id: number; chat: { id: number } };

function apiUrl(method: string) {
  return `https://api.telegram.org/bot${requireEnv("TELEGRAM_BOT_TOKEN")}/${method}`;
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
