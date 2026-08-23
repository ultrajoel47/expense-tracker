export type Intake = {
  updateId: string;
  chatId: string;
  text: string | null;
  photoFileId: string | null;
  replyToMessageId: string | null;
  callbackData: string | null;
};

type Photo = { file_id?: unknown; file_size?: unknown };

function biggestPhoto(photos: unknown): string | null {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  const sorted = [...(photos as Photo[])].sort(
    (a, b) => Number(b.file_size ?? 0) - Number(a.file_size ?? 0)
  );
  const fileId = sorted[0]?.file_id;
  return typeof fileId === "string" ? fileId : null;
}

export function toIntake(update: unknown): Intake | null {
  if (!update || typeof update !== "object") return null;
  const u = update as Record<string, any>;
  if (u.update_id === undefined || u.update_id === null) return null;

  const source = u.callback_query?.message ?? u.message;
  const chatId = source?.chat?.id;
  if (chatId === undefined || chatId === null) return null;

  return {
    updateId: String(u.update_id),
    chatId: String(chatId),
    text: typeof u.message?.text === "string" ? u.message.text : null,
    photoFileId: biggestPhoto(u.message?.photo),
    replyToMessageId:
      u.message?.reply_to_message?.message_id !== undefined
        ? String(u.message.reply_to_message.message_id)
        : null,
    callbackData:
      typeof u.callback_query?.data === "string" ? u.callback_query.data : null,
  };
}
