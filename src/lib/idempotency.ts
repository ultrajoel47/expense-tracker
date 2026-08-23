type ProcessedUpdateClient = {
  processedUpdate: { create(args: { data: { updateId: string } }): Promise<unknown> };
};

/**
 * Reclama un update_id de Telegram. Devuelve true si es la primera vez.
 *
 * Telegram reintenta el update si el webhook tarda en responder, y el OCR mas
 * la llamada a la IA pueden pasar los 15s. Sin esto, un reintento carga el
 * gasto dos veces. La exclusion la garantiza el indice unico de updateId, no
 * una lectura previa: dos reintentos concurrentes pasarian un findFirst.
 */
export async function claimUpdate(
  client: ProcessedUpdateClient,
  updateId: string
): Promise<boolean> {
  try {
    await client.processedUpdate.create({ data: { updateId } });
    return true;
  } catch {
    return false;
  }
}
