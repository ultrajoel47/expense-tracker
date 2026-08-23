/**
 * Formats a number as currency in Argentine Spanish format.
 * Example: 1650000.32 → "1.650.000,32"
 */
export function formatCurrency(amount: number): string {
  return amount.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Moneda con simbolo y sin decimales, para texto de chat: confirmaciones del
 * bot (`src/lib/expenses/create-from-bot.ts`) y respuestas de consulta
 * (`src/lib/queries/format.ts`). Ejemplo: 12000 -> "$12.000".
 *
 * Vivia adentro de `create-from-bot.ts` hasta que `queries/format.ts` necesito
 * el mismo formateador para un caso que no es "confirmar un gasto": moverlo
 * ACA, a un modulo sin ningun otro import, evita que uno de los dos dependa
 * del otro solo para una funcion generica de moneda. Deliberadamente distinta
 * de `formatCurrency` de arriba (esa es para la UI web, con dos decimales y
 * sin simbolo `$`; esta es para mensajes de Telegram) — no se unifican porque
 * sirven audiencias distintas con reglas de redondeo distintas.
 */
export function formatArs(amount: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Escapa el texto que va dentro de un mensaje con `parse_mode: "HTML"`.
 *
 * Telegram RECHAZA el mensaje entero si las entidades no parsean, y
 * `sendMessage` tira. En la Region 3 del webhook eso es grave y no cosmetico: el
 * gasto ya existe, la persona no recibe la confirmacion, reenvia el mensaje, y
 * el reenvio trae un `update_id` nuevo que la idempotencia no deduplica — o sea
 * que una descripcion con un "<" termina en un gasto duplicado. Los tres
 * caracteres son los que Telegram pide escapar para HTML.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
