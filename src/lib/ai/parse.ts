import { normalizeAmount, resolveDate } from "./normalize.ts";
import type { CorreccionPatch, CorreccionResult, DesconocidoResult, ParseContext, ParseResult } from "./types.ts";

export interface AiProvider {
  complete(system: string, user: string): Promise<string>;
}

/**
 * Categoria a la que cae un gasto cuando la IA devuelve una que no existe.
 *
 * Se EXPORTA porque no es un detalle interno de este modulo: `parseMessage`
 * garantiza que `categoryName` es una de las categorias que se le pasaron o
 * este literal, asi que el webhook tiene que poder resolverlo, y el DELETE/PUT
 * de categorias tiene que negarse a borrarlo o renombrarlo. Si el literal
 * viviera duplicado en esos tres lugares, cualquiera de los tres podria
 * quedarse atras y romper el bot en silencio.
 */
export const FALLBACK_CATEGORY = "Otros";

function buildSystemPrompt(ctx: ParseContext): string {
  const aliasLines = ctx.aliases.length
    ? ctx.aliases
        .map(
          (a) =>
            `- "${a.pattern}" => categoria "${a.categoryName}"` +
            (a.description ? `, descripcion "${a.description}"` : "") +
            (a.scope ? `, scope "${a.scope}"` : "")
        )
        .join("\n")
    : "(todavia no hay ninguno)";

  return `Sos un asistente que registra gastos de una pareja en Argentina.
Devolves UNICAMENTE un objeto JSON, sin markdown y sin texto alrededor.

Hoy es ${ctx.today} (zona America/Argentina/Buenos_Aires).

Integrantes: ${ctx.members.map((m) => m.name).join(", ")}.
Categorias disponibles (elegi exactamente una de esta lista):
${ctx.categories.map((c) => `- ${c}`).join("\n")}

Equivalencias ya conocidas:
${aliasLines}

Formato de respuesta para un gasto:
{
  "intent": "gasto",
  "amount": <numero entero de pesos, sin jerga ni texto, ej 12000>,
  "description": "<comercio, persona o concepto, corto>",
  "date": "<YYYY-MM-DD>",
  "categoryName": "<una de la lista>",
  "scope": "casa" | "personal",
  "payerName": "<nombre del integrante que pago, o null si es quien escribe>",
  "installments": <cantidad de cuotas o null>,
  "cardName": "<nombre de la tarjeta o null>"
}

Si el mensaje es una PREGUNTA sobre gastos ya registrados (cuanto gastamos,
cuanto llevamos, mostrame los de tal categoria):
{ "intent": "consulta_no_soportada" }

Si el mensaje no describe un gasto ni es una de esas preguntas:
{ "intent": "desconocido", "reason": "<motivo breve>" }

Si el mensaje CORRIGE un gasto que ya se registro ("eso fue personal", "en
realidad fueron 15 lucas", "no, era farmacia", "cambiale la fecha a ayer"):
{
  "intent": "correccion",
  "patch": {
    "amount": <numero o null>,
    "description": "<texto o null>",
    "date": "<YYYY-MM-DD o null>",
    "categoryName": "<una de la lista o null>",
    "scope": "casa" | "personal" | null
  }
}

Reglas:
- Una transferencia, un pago o un "le pague a X" a una persona, un comercio o
  un alias TAMBIEN es un gasto (intent "gasto"), aunque no se compre algo
  explicito. El nombre del destinatario va en "description".
- "amount" es siempre el numero final en pesos, con la jerga ya resuelta:
  una "luca" son 1.000 pesos, un "palo" son 1.000.000 de pesos. Por ejemplo
  "2 palos" son 2000000 y "3 lucas con 500" son 3500. Nunca devuelvas la
  jerga en texto ni el numero sin multiplicar.
- "scope" es "casa" cuando el gasto lo usan o se benefician los dos: comida,
  supermercado, servicios, alquiler, el auto, salud y farmacia, salidas o
  comidas compartidas, y en general cualquier cosa del hogar. Es "personal"
  solo cuando es de una sola persona: su ropa, su hobby, un regalo que hace.
  Si el mensaje nombra al otro integrante del hogar como acompañante (por su
  nombre o por un apodo o diminutivo que le corresponda, aunque no se
  parezca en las letras: los apodos en español muchas veces no derivan del
  nombre completo de forma obvia, ej. "Pepe" por "Jose", "Vicky" o "Vir" por
  "Virginia", "Male" por "Maria Elena". Fijate si el apodo mencionado podria
  referirse a alguno de los integrantes de la lista antes de asumir que es
  otra persona), el gasto es "casa".
- Nunca inventes una categoria que no este en la lista.
- Para la fecha, resolve expresiones como "ayer" o "el viernes" contra la
  fecha de hoy y devolve SIEMPRE el formato YYYY-MM-DD.
- Nunca devuelvas una fecha futura.
- Una correccion habla de algo YA registrado y no vuelve a describir el gasto
  entero: "eso", "ese", "el ultimo", "en realidad", "no, era". En "patch" van
  SOLO los campos que la persona corrige y el resto en null. Si el mensaje
  describe un gasto con su monto y su concepto, es "gasto" y no "correccion",
  aunque venga justo despues de otro gasto.
- No se borra por texto: si la persona pide borrar o anular algo, devolve
  "desconocido" con reason "para borrar usa el boton Borrar de la confirmacion".`;
}

function extractJson(raw: string): unknown {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Valida el patch de una correccion.
 *
 * **Un campo que no se entiende se DESCARTA, no cae a un default.** En un
 * gasto nuevo, una categoria inventada cae a FALLBACK_CATEGORY porque hay que
 * guardar algo; en una correccion no hay nada que guardar, y recategorizar a
 * "Otros" un gasto que estaba bien seria destruir un dato correcto por un typo
 * de la IA.
 *
 * Si al terminar el patch quedo vacio no es una correccion aplicable: se
 * devuelve "desconocido" con el motivo, para que el bot lo diga en vez de
 * contestar "listo" sin haber cambiado nada. Si quedo algo, se aplica eso: la
 * confirmacion muestra el gasto resultante, asi que lo que no cambio se ve.
 */
function buildCorreccion(
  parsed: Record<string, unknown>,
  ctx: ParseContext
): CorreccionResult | DesconocidoResult {
  const raw = (parsed.patch ?? {}) as Record<string, unknown>;
  const patch: CorreccionPatch = {};
  const descartados: string[] = [];

  if (raw.amount !== null && raw.amount !== undefined) {
    const amount =
      typeof raw.amount === "string" || typeof raw.amount === "number"
        ? normalizeAmount(raw.amount)
        : null;
    if (amount === null) descartados.push("el monto");
    else patch.amount = amount;
  }

  if (typeof raw.description === "string" && raw.description.trim()) {
    patch.description = raw.description.trim();
  }

  if (raw.date !== null && raw.date !== undefined) {
    const date = resolveDate(String(raw.date), new Date(`${ctx.today}T12:00:00.000Z`));
    if (date === null) descartados.push("la fecha");
    else patch.date = date;
  }

  if (typeof raw.categoryName === "string" && raw.categoryName.trim()) {
    const nombre = raw.categoryName.trim();
    if (ctx.categories.includes(nombre)) patch.categoryName = nombre;
    else descartados.push(`la categoria "${nombre}"`);
  }

  if (raw.scope === "casa" || raw.scope === "personal") patch.scope = raw.scope;
  else if (raw.scope !== null && raw.scope !== undefined) descartados.push("el ambito");

  if (Object.keys(patch).length === 0) {
    return {
      intent: "desconocido",
      reason: descartados.length
        ? `no pude entender ${descartados.join(" ni ")}`
        : "no entendi que queres corregir",
    };
  }

  return { intent: "correccion", patch };
}

export async function parseMessage(
  text: string,
  ctx: ParseContext,
  provider: AiProvider
): Promise<ParseResult> {
  let raw: string;
  try {
    raw = await provider.complete(buildSystemPrompt(ctx), text);
  } catch (error) {
    return { intent: "desconocido", reason: `El proveedor de IA fallo: ${error}` };
  }

  const parsed = extractJson(raw) as Record<string, unknown> | null;
  if (!parsed) {
    return { intent: "desconocido", reason: "La IA no devolvio JSON valido" };
  }

  if (parsed.intent === "consulta_no_soportada") {
    return { intent: "consulta_no_soportada" };
  }

  if (parsed.intent === "correccion") {
    return buildCorreccion(parsed, ctx);
  }

  if (parsed.intent !== "gasto") {
    const reason = typeof parsed.reason === "string" ? parsed.reason : "No parece un gasto";
    return { intent: "desconocido", reason };
  }

  const rawAmount = parsed.amount;
  const amount =
    typeof rawAmount === "string" || typeof rawAmount === "number"
      ? normalizeAmount(rawAmount)
      : null;
  if (amount === null) {
    return { intent: "desconocido", reason: "No pude entender el monto" };
  }

  const today = new Date(`${ctx.today}T12:00:00.000Z`);
  const date = resolveDate(String(parsed.date ?? ""), today);
  if (date === null) {
    return { intent: "desconocido", reason: "No pude entender la fecha" };
  }

  const description =
    typeof parsed.description === "string" && parsed.description.trim()
      ? parsed.description.trim()
      : "Sin descripcion";

  const categoryName = ctx.categories.includes(parsed.categoryName as string)
    ? (parsed.categoryName as string)
    : FALLBACK_CATEGORY;

  const scope = parsed.scope === "personal" ? "personal" : "casa";

  const payerName =
    typeof parsed.payerName === "string" &&
    ctx.members.some((m) => m.name.toLowerCase() === parsed.payerName!.toString().toLowerCase())
      ? (parsed.payerName as string)
      : null;

  const rawInstallments = Number(parsed.installments);
  const installments =
    Number.isInteger(rawInstallments) && rawInstallments > 1 ? rawInstallments : null;

  const cardName = typeof parsed.cardName === "string" && parsed.cardName.trim()
    ? parsed.cardName.trim()
    : null;

  return {
    intent: "gasto",
    amount,
    description,
    date,
    categoryName,
    scope,
    payerName,
    installments,
    cardName,
  };
}
