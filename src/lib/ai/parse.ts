import { normalizeAmount, resolveDate } from "./normalize.ts";
import type {
  ConsultaMetric,
  ConsultaNoSoportadaResult,
  ConsultaResult,
  CorreccionPatch,
  CorreccionResult,
  DesconocidoResult,
  ParseContext,
  ParseResult,
} from "./types.ts";

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

/**
 * Descripcion de respaldo cuando la IA no devuelve ninguna en un gasto.
 *
 * Se EXPORTA por el mismo motivo que `FALLBACK_CATEGORY`: `src/lib/aliases.ts`
 * necesita este MISMO literal para que `esPatronAprendible` rechace aprender un
 * alias con este patron. Si viviera duplicado a mano en los dos archivos, uno
 * de los dos podria quedarse atras sin que nada lo marque — y el silencio aca
 * es concreto: si divergen, `esPatronAprendible` deja de reconocer la
 * descripcion de respaldo y el sistema aprende un alias con patron "sin
 * descripcion", que despues arrastra a esa categoria a todo gasto sin
 * descripcion.
 */
export const FALLBACK_DESCRIPTION = "Sin descripcion";

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
cuanto llevamos, en que se nos fue la plata, como venimos):
{
  "intent": "consulta",
  "metric": "total" | "por_categoria" | "tendencia",
  "from": "<YYYY-MM-DD>",
  "to": "<YYYY-MM-DD>",
  "categoryName": "<una de la lista o null>",
  "scope": "casa" | "personal" | null
}

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
- Las "Equivalencias ya conocidas" son cosas que la pareja ya corrigio a mano:
  si la descripcion del gasto coincide con una de esas equivalencias, usa la
  categoria (y el ambito, si lo trae) que dice la equivalencia, salvo que el
  mensaje diga explicitamente otra cosa. Una equivalencia vale mas que tu
  intuicion sobre el nombre del comercio, porque alguien la enseno.
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
  "desconocido" con reason "para borrar usa el boton Borrar de la confirmacion".
- Para una consulta, "metric" es "total" si preguntan cuanto se gasto,
  "por_categoria" si preguntan en que se gasto o como se reparte, y
  "tendencia" si preguntan como viene la cosa o comparan con meses anteriores.
- "from" y "to" son el rango de la pregunta, inclusive, resuelto contra la
  fecha de hoy: "este mes" es del primero al ultimo dia del mes de hoy,
  "julio" es todo julio del año en curso, "los ultimos 3 meses" termina hoy.
  Devolve siempre las dos fechas en YYYY-MM-DD, nunca una expresion.
- Nunca calcules ni inventes montos, totales ni promedios: no los tenes, y el
  numero lo pone el sistema. Tu unico trabajo en una consulta es traducir la
  pregunta a ese objeto.`;
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

/**
 * Cuanto para atras puede preguntar una consulta. No es una restriccion del
 * dominio sino un techo de sensatez: acota el trabajo de la agregacion y, sobre
 * todo, la cantidad de meses que la consulta puede materializar (ver
 * `resolveConsulta` en `src/lib/queries/aggregate.ts`).
 */
export const CONSULTA_MESES_MAXIMOS = 24;

/**
 * Valida una fecha ISO de una consulta, a mediodia UTC (mismo horario que usa
 * el resto del modulo para representar "un dia").
 *
 * A diferencia de `resolveDate`, esta funcion NO rechaza por antiguedad ni por
 * ser futura: esas son reglas del RANGO de una consulta (ver `buildConsulta`),
 * no de la fecha de un gasto. Lo unico que valida es que la fecha sea real: un
 * `"2026-02-31"` construido con `new Date(...)` se normaliza silenciosamente a
 * marzo, asi que hay que verificar que los componentes (año, mes, dia) vuelvan
 * iguales a los que se pidieron.
 */
function parseFechaConsulta(raw: unknown): Date | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;

  const [y, m, d] = raw.split("-").map(Number);
  const date = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

/** Type guard: evita depender de un narrowing de `unknown` por exclusion, que
 * no es confiable en TypeScript (`x !== "a" && x !== "b"` no reduce el tipo de
 * un `unknown`). Con esto, el `if (!esMetricaValida(...))` de abajo narrowea
 * de verdad. */
function esMetricaValida(m: unknown): m is ConsultaMetric {
  return m === "total" || m === "por_categoria" || m === "tendencia";
}

/**
 * Valida y acota una consulta ya emitida por la IA como `{ intent: "consulta",
 * metric, from, to, categoryName, scope }`.
 *
 * **No usa `resolveDate`**: esa funcion rechaza una fecha de mas de 6 meses
 * atras, que es correcto para la fecha de UN GASTO y equivocado para el RANGO
 * de una consulta ("como venimos en el año" necesita ir 12 meses atras). El
 * limite propio de una consulta es `CONSULTA_MESES_MAXIMOS`.
 *
 * Reglas en orden; la primera que rechaza corta el resto:
 *
 *  1. `metric` es una de las tres conocidas.
 *  2. `from` y `to` son fechas ISO reales.
 *  3. `from <= to`, sobre las fechas SIN recortar.
 *  4. `to` se recorta a hoy si vino en el futuro (nunca se rechaza por esto:
 *     preguntar "cuanto llevamos este mes" un dia 10 trae un `to` a fin de
 *     mes, y la respuesta correcta es "hasta hoy", no un error).
 *  5. `from` se recorta al piso de `CONSULTA_MESES_MAXIMOS` meses atras si lo
 *     excede. Si despues de los dos recortes el rango quedo invertido, ahi si
 *     se rechaza: el rango pedido era enteramente mas viejo de lo que se puede
 *     mirar.
 *  6. `categoryName`, si vino, tiene que existir en `ctx.categories`. NO se
 *     descarta en silencio: descartarla convertiria "cuanto gastamos en cine"
 *     en "cuanto gastamos en total", un numero correcto para una pregunta que
 *     nadie hizo.
 *  7. `scope` solo se conserva si es exactamente "casa" o "personal";
 *     cualquier otra cosa se descarta a `null` sin rechazar la consulta (una
 *     consulta sin ambito es la pregunta normal).
 */
function buildConsulta(
  parsed: Record<string, unknown>,
  ctx: ParseContext
): ConsultaResult | ConsultaNoSoportadaResult {
  if (!esMetricaValida(parsed.metric)) {
    return { intent: "consulta_no_soportada", reason: "todavia no se responder ese tipo de pregunta" };
  }
  const metric = parsed.metric;

  const from = parseFechaConsulta(parsed.from);
  const to = parseFechaConsulta(parsed.to);
  if (!from || !to) {
    return { intent: "consulta_no_soportada", reason: "no entendi de que fechas me hablas" };
  }

  if (from.getTime() > to.getTime()) {
    return { intent: "consulta_no_soportada", reason: "el rango que entendi esta al reves" };
  }

  // "hoy" en Buenos Aires: `ctx.today` ya viene calculado asi por el llamador
  // (el webhook lo arma con `todayInBuenosAires(new Date())`), igual que lo
  // usa el resto de este modulo para resolver la fecha de un gasto o de una
  // correccion.
  const hoy = new Date(`${ctx.today}T12:00:00.000Z`);

  const toRecortado = to.getTime() > hoy.getTime() ? hoy : to;

  const piso = new Date(hoy);
  piso.setUTCMonth(piso.getUTCMonth() - CONSULTA_MESES_MAXIMOS);
  const fromRecortado = from.getTime() < piso.getTime() ? piso : from;

  if (fromRecortado.getTime() > toRecortado.getTime()) {
    return { intent: "consulta_no_soportada", reason: "eso es demasiado atras para lo que puedo mirar" };
  }

  let categoryName: string | null = null;
  if (typeof parsed.categoryName === "string" && parsed.categoryName.trim()) {
    const nombre = parsed.categoryName.trim();
    if (!ctx.categories.includes(nombre)) {
      return { intent: "consulta_no_soportada", reason: `no tengo una categoria "${nombre}"` };
    }
    categoryName = nombre;
  }

  const scope = parsed.scope === "casa" || parsed.scope === "personal" ? parsed.scope : null;

  return {
    intent: "consulta",
    query: { metric, from: fromRecortado, to: toRecortado, categoryName, scope },
  };
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

  if (parsed.intent === "consulta") {
    return buildConsulta(parsed, ctx);
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
      : FALLBACK_DESCRIPTION;

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
