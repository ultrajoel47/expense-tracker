import { normalizeAmount, resolveDate } from "./normalize.ts";
import type { ParseContext, ParseResult } from "./types.ts";

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

Si el mensaje no describe un gasto:
{ "intent": "desconocido", "reason": "<motivo breve>" }

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
- Nunca devuelvas una fecha futura.`;
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
