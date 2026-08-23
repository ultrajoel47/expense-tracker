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

/**
 * Reescribe un mensaje que el bot ya mando. Es lo que hace que la
 * confirmacion sea el estado actual del gasto y no un historial: al corregir,
 * el mensaje viejo se reescribe en vez de acumular uno nuevo por cambio.
 */
export async function editMessageText(
  chatId: string | number,
  messageId: string | number,
  text: string,
  replyMarkup?: unknown
): Promise<void> {
  const res = await fetch(apiUrl("editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: Number(messageId),
      text,
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  const json = await res.json();
  // "message is not modified" NO es una falla: pasa cuando se re-renderiza el
  // mismo estado, que es exactamente lo que hace tocar dos veces un boton de
  // objetivo explicito (ver el comentario de cabecera de callbacks.ts). Tratarlo
  // como error convertiria el caso normal de un doble tap en un log de error.
  if (!json.ok && !String(json.description ?? "").includes("message is not modified")) {
    throw new Error(`Telegram editMessageText fallo: ${JSON.stringify(json)}`);
  }
}

/**
 * Cambia SOLO el teclado de un mensaje, sin tocar su texto. Es lo que usan los
 * botones de navegacion (abrir categorias, volver, confirmar borrado): no
 * cambian el gasto, asi que reconstruir el texto de la confirmacion seria
 * arriesgar un texto mal armado sin ninguna ganancia.
 */
export async function editMessageReplyMarkup(
  chatId: string | number,
  messageId: string | number,
  replyMarkup: unknown
): Promise<void> {
  const res = await fetch(apiUrl("editMessageReplyMarkup"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: Number(messageId),
      reply_markup: replyMarkup,
    }),
  });

  const json = await res.json();
  // Misma tolerancia que editMessageText: tocar dos veces el mismo boton de
  // menu re-renderiza el mismo teclado, y eso NO es una falla.
  if (!json.ok && !String(json.description ?? "").includes("message is not modified")) {
    throw new Error(`Telegram editMessageReplyMarkup fallo: ${JSON.stringify(json)}`);
  }
}

/**
 * Contesta un callback_query. Telegram lo EXIGE: sin esto el boton se queda
 * girando en el cliente aunque la correccion se haya aplicado.
 *
 * Un fallo aca no se relanza. Los callback_query expiran (Telegram los
 * descarta al rato) y contestar uno vencido devuelve `ok:false`; a esa altura
 * la correccion YA se aplico, asi que tirar convertiria un exito con un acuse
 * perdido en un camino de error. Se loguea y sigue.
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  const res = await fetch(apiUrl("answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    }),
  });

  const json = await res.json();
  if (!json.ok) {
    console.error(`Telegram answerCallbackQuery fallo: ${JSON.stringify(json)}`);
  }
}
