/**
 * Formatea una `ConsultaAnswer` (`src/lib/queries/aggregate.ts`) como el texto
 * que el bot manda por Telegram.
 *
 * Separado de `aggregate.ts` a proposito: agregar (leer Prisma, sumar cargos)
 * y formatear (elegir palabras, cortar una lista larga) son dos trabajos
 * distintos con motivos de cambio distintos — un ajuste de redaccion no tiene
 * por que tocar el modulo que agrega, y viceversa. Mismo criterio que separa
 * `charges.ts` de `create-from-bot.ts`: cada archivo hace una sola cosa.
 *
 * Puro: sin `@/`, imports relativos con extension.
 */
import { formatArs } from "../format.ts";
import type { ConsultaAnswer } from "./aggregate.ts";
import type { ConsultaQuery } from "../ai/types.ts";

/** Cuantas categorias se listan como mucho en "por_categoria" antes de
 * agrupar el resto en un "y N mas". Un mensaje de Telegram no es una tabla:
 * mas de esto y la respuesta deja de leerse de un vistazo. */
const MAX_FILAS_POR_CATEGORIA = 8;

/**
 * "en-CA" en vez de "es-AR", igual que `todayInBuenosAires`
 * (`src/lib/ai/normalize.ts`): en este entorno, `Intl.DateTimeFormat("es-AR",
 * { day: "2-digit" })` NO rellena con cero ("1/8" en vez de "01/08"), pero
 * "en-CA" con las mismas opciones si lo hace. Se extraen los componentes ya
 * paddeados y se arma el formato dd/MM a mano.
 */
const PARTES_FECHA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function partesFecha(d: Date): { day: string; month: string; year: string } {
  const [year, month, day] = PARTES_FECHA.format(d).split("-");
  return { day, month, year };
}

/**
 * "01/08 al 23/08" (o con año si el rango cruza un 1 de enero): es lo mas
 * importante del formateo. Sin decir que periodo se entendio, un numero
 * plausible y equivocado (la IA leyo mal "este mes") no tiene forma de
 * notarse: la persona lo compara contra lo que ella pidio, no contra el
 * codigo.
 */
function describirRango(from: Date, to: Date): string {
  const f = partesFecha(from);
  const t = partesFecha(to);
  const mismoAnio = f.year === t.year;
  const fmt = (p: { day: string; month: string; year: string }) =>
    mismoAnio ? `${p.day}/${p.month}` : `${p.day}/${p.month}/${p.year}`;
  return `${fmt(f)} al ${fmt(t)}`;
}

/** " (en Ropa, personales)": si `scope` o `categoryName` vinieron, la persona
 * tiene que ver que la pregunta se entendio acotada a eso. */
function describirAlcance(query: ConsultaQuery): string {
  const partes: string[] = [];
  if (query.categoryName) partes.push(`en ${query.categoryName}`);
  if (query.scope === "casa") partes.push("de casa");
  if (query.scope === "personal") partes.push("personales");
  return partes.length ? ` (${partes.join(", ")})` : "";
}

function encabezado(query: ConsultaQuery): string {
  return `Del ${describirRango(query.from, query.to)}${describirAlcance(query)}`;
}

/** "agosto 2026", a partir de un periodo "YYYY-MM" (`periodKey`,
 * `src/lib/recurring-materialize.ts`). */
function nombreMes(periodo: string): string {
  const [y, m] = periodo.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1))
  );
}

export function formatConsultaAnswer(answer: ConsultaAnswer, query: ConsultaQuery): string {
  const header = encabezado(query);

  if (answer.kind === "total") {
    if (answer.cantidad === 0) return `${header}: no encontre gastos en ese período.`;
    return `${header}: ${formatArs(answer.total)} en ${answer.cantidad} gasto${answer.cantidad === 1 ? "" : "s"}.`;
  }

  if (answer.kind === "por_categoria") {
    if (answer.filas.length === 0) return `${header}: no encontre gastos en ese período.`;

    const visibles = answer.filas.slice(0, MAX_FILAS_POR_CATEGORIA);
    const resto = answer.filas.slice(MAX_FILAS_POR_CATEGORIA);

    const lineas = visibles.map((f) => `${f.categoryName}: ${formatArs(f.total)}`);
    if (resto.length) {
      const totalResto = resto.reduce((s, f) => s + f.total, 0);
      lineas.push(`y ${resto.length} más: ${formatArs(totalResto)}`);
    }

    return [`${header}:`, ...lineas, `Total: ${formatArs(answer.total)}`].join("\n");
  }

  // "tendencia"
  const conGasto = answer.meses.filter((m) => m.total > 0);
  if (conGasto.length === 0) return `${header}: no encontre gastos en ese período.`;

  const lineas = answer.meses.map((m) => `${nombreMes(m.periodo)}: ${formatArs(m.total)}`);
  return [`${header}:`, ...lineas].join("\n");
}
