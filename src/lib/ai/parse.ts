import { normalizeAmount, resolveDate } from "./normalize.ts";
import type { ParseContext, ParseResult } from "./types.ts";

export interface AiProvider {
  complete(system: string, user: string): Promise<string>;
}

const FALLBACK_CATEGORY = "Otros";

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
  "description": "<comercio o concepto, corto>",
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
- "scope" es "casa" si el gasto es del hogar y lo aprovechan los dos
  (supermercado, servicios, alquiler, delivery compartido). Es "personal" si
  es de una sola persona (ropa, un hobby, algo propio).
- Nunca inventes una categoria que no este en la lista.
- Para la fecha, resolve expresiones como "ayer" o "el viernes" contra la
  fecha de hoy y devolve SIEMPRE el formato YYYY-MM-DD.
- Nunca devuelvas una fecha futura.`;
}

function extractJson(raw: string): unknown {
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

  const amount = normalizeAmount(parsed.amount as string | number);
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
