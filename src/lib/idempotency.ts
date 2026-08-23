type ProcessedUpdateClient = {
  processedUpdate: { create(args: { data: { updateId: string } }): Promise<unknown> };
};

/**
 * Verdadero si el error es la violacion de restriccion unica de Prisma
 * (P2002), sin importar el namespace de Prisma para no romper la pureza
 * de este modulo. Cualquier otro error (timeout, caida de conexion,
 * failover del replica set) no es una duplicacion: es un fallo real que
 * hay que propagar.
 */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

/**
 * Reclama un update_id de Telegram. Devuelve true si es la primera vez.
 *
 * Telegram reintenta el update si el webhook tarda en responder, y el OCR mas
 * la llamada a la IA pueden pasar los 15s. Sin esto, un reintento carga el
 * gasto dos veces. La exclusion la garantiza el indice unico de updateId, no
 * una lectura previa: dos reintentos concurrentes pasarian un findFirst.
 *
 * Solo una violacion de indice unico (P2002) cuenta como "ya procesado".
 * Un error transitorio de base de datos NO es una duplicacion: tratarlo
 * como tal descartaria en silencio un mensaje nuevo — exactamente el
 * fallo que este mecanismo existe para evitar. Por eso se relanza.
 */
export async function claimUpdate(
  client: ProcessedUpdateClient,
  updateId: string
): Promise<boolean> {
  try {
    await client.processedUpdate.create({ data: { updateId } });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

export { isDuplicateKeyError };
