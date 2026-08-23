/**
 * Los botones de la confirmacion, y el parseo de su `callback_data`.
 *
 * **El dato lleva el objetivo EXPLICITO, no una orden de invertir.** Telegram
 * no expira los mensajes: un boton de hace tres semanas sigue siendo tocable,
 * y cada tap llega con un `update_id` NUEVO, que la idempotencia de
 * `ProcessedUpdate` no deduplica porque no es un reintento — es un tap nuevo.
 * Un boton que dijera "cambiar el scope" aplicaria una inversion sobre el
 * estado actual, asi que dos taps lo dejan como estaba y el segundo tap es
 * indistinguible del primero. Con el valor destino adentro del dato ("poner
 * personal"), tocar el mismo boton dos veces escribe dos veces lo mismo y el
 * resultado final es siempre el que la persona leyo en el boton.
 *
 * Presupuesto: Telegram limita `callback_data` a **64 bytes**. El caso mas
 * largo es `cat:<24>:<24>` = 53. Cualquier tag nuevo tiene que entrar ahi.
 */

export type CallbackAction =
  | { kind: "scope"; expenseId: string; scope: "casa" | "personal" }
  | { kind: "categoryMenu"; expenseId: string }
  | { kind: "category"; expenseId: string; categoryId: string }
  | { kind: "deleteAsk"; expenseId: string }
  | { kind: "deleteConfirm"; expenseId: string }
  | { kind: "cancel"; expenseId: string };

export type InlineButton = { text: string; callback_data: string };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };

/** Un ObjectId de Mongo: 24 hex. */
const ID_RE = /^[a-f0-9]{24}$/i;

/**
 * Parsea el `callback_data` de un boton. Devuelve `null` ante cualquier cosa
 * que no sea exactamente una de las formas conocidas.
 *
 * El webhook es publico y el `callback_data` viaja por el cliente, asi que se
 * valida la forma del id aca en vez de pasarle a Prisma un string arbitrario:
 * un ObjectId mal formado hace TIRAR a `findFirst`, y en el webhook un throw
 * cuesta un camino de error entero.
 */
export function parseCallbackData(data: string | null | undefined): CallbackAction | null {
  if (!data) return null;
  const parts = data.split(":");
  const [tag, expenseId, arg] = parts;
  if (!expenseId || !ID_RE.test(expenseId)) return null;

  switch (tag) {
    case "sc":
      if (parts.length !== 3) return null;
      if (arg !== "casa" && arg !== "personal") return null;
      return { kind: "scope", expenseId, scope: arg };
    case "cat":
      if (parts.length === 2) return { kind: "categoryMenu", expenseId };
      if (parts.length === 3 && arg && ID_RE.test(arg)) {
        return { kind: "category", expenseId, categoryId: arg };
      }
      return null;
    case "del":
      return parts.length === 2 ? { kind: "deleteAsk", expenseId } : null;
    case "delok":
      return parts.length === 2 ? { kind: "deleteConfirm", expenseId } : null;
    case "cx":
      return parts.length === 2 ? { kind: "cancel", expenseId } : null;
    default:
      return null;
  }
}

/**
 * El teclado normal de una confirmacion. El boton de scope nombra el DESTINO,
 * no la accion: se lee "→ personal" y eso es literalmente lo que hace.
 */
export function buildExpenseKeyboard(expenseId: string, scope: string): InlineKeyboard {
  const destino = scope === "personal" ? "casa" : "personal";
  return {
    inline_keyboard: [
      [{ text: `→ ${destino}`, callback_data: `sc:${expenseId}:${destino}` }],
      [{ text: "Categoria", callback_data: `cat:${expenseId}` }],
      [{ text: "Borrar", callback_data: `del:${expenseId}` }],
    ],
  };
}

/** El submenu de categorias, dos por fila, con una salida. */
export function buildCategoryKeyboard(
  expenseId: string,
  categories: readonly { id: string; name: string }[]
): InlineKeyboard {
  const rows: InlineButton[][] = [];
  for (let i = 0; i < categories.length; i += 2) {
    rows.push(
      categories.slice(i, i + 2).map((c) => ({
        text: c.name,
        callback_data: `cat:${expenseId}:${c.id}`,
      }))
    );
  }
  rows.push([{ text: "« Volver", callback_data: `cx:${expenseId}` }]);
  return { inline_keyboard: rows };
}

/**
 * Borrar pide un segundo tap. Es la unica accion irreversible del teclado —
 * las otras dos se deshacen tocando otro boton— y esta a un dedo de distancia
 * de "Categoria" en una pantalla de telefono.
 */
export function buildDeleteConfirmKeyboard(expenseId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "Si, borrar", callback_data: `delok:${expenseId}` },
        { text: "No", callback_data: `cx:${expenseId}` },
      ],
    ],
  };
}
