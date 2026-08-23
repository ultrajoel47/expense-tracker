/**
 * Resuelve el intent "consulta" con Prisma.
 *
 * Puro en el sentido del repo: cliente inyectado, imports relativos con
 * extension, sin `@/`. Testeable sin base con un cliente falso, igual que
 * `src/lib/expenses/correct.ts` y `src/lib/aliases.ts`.
 *
 * **La regla del bloque, otra vez, porque es la que gobierna este archivo:**
 * el LLM ya tradujo la pregunta a una `ConsultaQuery` (en `src/lib/ai/parse.ts`)
 * sin ver ningun numero. Esta funcion agrega con Prisma y `expensesToCharges`
 * — la MISMA funcion que usa `src/app/api/expenses/stats/route.ts` — para que
 * el bot nunca tenga una forma de sumar distinta de la del dashboard. Si algun
 * dia este archivo suma los cargos con su propia cuenta en vez de reusar
 * `expensesToCharges`, el bloque esta mal aunque los tests sigan pasando.
 */
import { visibleExpensesWhere } from "../visibility.ts";
import { expensesToCharges, type Charge, type ChargeableExpense } from "../expenses/charges.ts";
import { materializeRecurringForMonthSafely, periodKey, type MaterializeClient } from "../recurring-materialize.ts";
import type { ConsultaQuery } from "../ai/types.ts";

/** El minimo de Prisma que este modulo usa, escrito a mano para no importar
 * `@prisma/client` (misma razon que en `correct.ts` y `aliases.ts`). Extiende
 * `MaterializeClient` porque `resolveConsulta` tambien tiene que poder
 * materializar los recurrentes de los meses del rango (ver el punto 1 de
 * `resolveConsulta`), y esa es la firma real que pide
 * `materializeRecurringForMonthSafely`. */
export type ConsultaClient = MaterializeClient & {
  expense: {
    findMany(args: unknown): Promise<ChargeableExpense[]>;
  };
};

/**
 * `materializacionFallida` es un campo HERMANO de `kind` en las tres variantes,
 * no un envoltorio `{ answer, materializacionFallida }` alrededor de la union:
 * asi `formatConsultaAnswer` sigue haciendo `switch`/`if` sobre `answer.kind`
 * sin desenvolver nada primero, y el campo viaja pegado al resultado que
 * describe en vez de vivir en una capa aparte que se puede perder al pasar el
 * valor de mano en mano.
 *
 * True si la materializacion de algun mes del rango fallo. El numero que
 * sigue es correcto para lo que hay en la base, pero puede faltarle los
 * recurrentes de ese mes — o sea que puede estar CORTO. Callarlo hace que el
 * bot conteste un total incompleto con la misma cara que uno completo.
 */
export type ConsultaAnswer =
  | { kind: "total"; total: number; cantidad: number; materializacionFallida: boolean }
  | {
      kind: "por_categoria";
      filas: { categoryName: string; total: number }[];
      total: number;
      materializacionFallida: boolean;
    }
  | { kind: "tendencia"; meses: { periodo: string; total: number }[]; materializacionFallida: boolean };

/** Cada mes calendario tocado por `[from, to]`, inclusive de los dos extremos.
 * `from <= to` esta garantizado por `buildConsulta` (`src/lib/ai/parse.ts`)
 * antes de que una `ConsultaQuery` pueda existir. */
function mesesDelRango(from: Date, to: Date): { year: number; month: number }[] {
  const meses: { year: number; month: number }[] = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth() + 1;
  const finYear = to.getUTCFullYear();
  const finMonth = to.getUTCMonth() + 1;

  while (year < finYear || (year === finYear && month <= finMonth)) {
    meses.push({ year, month });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return meses;
}

/** Medianoche UTC del dia de `d`. `query.from`/`query.to` llegan a mediodia UTC
 * (la convencion del resto del repo para representar "un dia"), pero un gasto
 * cargado a mano en la web no tiene por que respetar esa convencion horaria:
 * normalizar el limite a medianoche evita descartar un gasto real por una
 * diferencia de horas dentro del mismo dia. */
function inicioDelDia(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** El dia siguiente a `d`, a medianoche UTC: el limite EXCLUSIVO que necesita
 * `expensesToCharges` para cubrir el dia de `d` entero. */
function diaSiguiente(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

function totalDeCargos(cargos: Charge[]): number {
  return cargos.reduce((s, c) => s + c.amount, 0);
}

function porCategoria(cargos: Charge[], materializacionFallida: boolean): ConsultaAnswer {
  const mapa = new Map<string, number>();
  for (const c of cargos) {
    mapa.set(c.categoryName, (mapa.get(c.categoryName) ?? 0) + c.amount);
  }
  const filas = [...mapa.entries()]
    .map(([categoryName, total]) => ({ categoryName, total }))
    .sort((a, b) => b.total - a.total);
  return { kind: "por_categoria", filas, total: totalDeCargos(cargos), materializacionFallida };
}

/**
 * Resuelve una consulta ya validada contra la base.
 *
 * 1. **Materializa los recurrentes de cada mes del rango.** Es la MISMA
 *    escritura idempotente que ya disparan los dos GET del dashboard
 *    (`/api/expenses` y `/api/expenses/stats`): sin esto, el alquiler de un
 *    mes que todavia no se abrio en el dashboard no aparece en la respuesta
 *    del bot aunque si aparezca despues en la web. El loop es seguro porque:
 *      - El rango ya viene acotado a `CONSULTA_MESES_MAXIMOS` (24 meses) por
 *        `buildConsulta` (`src/lib/ai/parse.ts`), asi que el loop nunca es
 *        gigante.
 *      - `esPeriodoMaterializable`, DENTRO de
 *        `materializeRecurringForMonthSafely`, descarta sin tocar la base
 *        cualquier mes fuera de `[PRIMER_PERIODO_MATERIALIZABLE, el mes
 *        actual en Buenos Aires]`. Iterar meses futuros o anteriores al piso
 *        no escribe nada: son no-ops.
 *    Un fallo de materializacion NUNCA aborta la respuesta: se sirve con lo
 *    que ya este materializado, igual que en `stats/route.ts`, y el proximo
 *    GET del dashboard reintenta la misma escritura idempotente. Pero el fallo
 *    tampoco se calla: el `onError` opcional (mismo patron que `learnAlias` y
 *    `recordAliasHit` en `src/lib/aliases.ts`) deja que el llamador lo loguee,
 *    y `materializacionFallida` en el resultado (ver `ConsultaAnswer` arriba)
 *    lo hace visible en la respuesta del bot: sin esto, un fallo permanente de
 *    materializacion se ve como "el alquiler no esta" sin ningun rastro, para
 *    siempre, cada vez que alguien pregunte por ese mes.
 * 2. Trae los gastos SIN filtro de fecha, con el predicado de visibilidad
 *    (`visibleExpensesWhere`, armado ACA con `actorId` y `householdUserIds` —
 *    nunca recibido ya armado, para que esta funcion nunca pueda olvidarlo) y
 *    las cuotas incluidas. Sin filtro de fecha a proposito, igual que
 *    `stats/route.ts`: una cuota que vence dentro del rango puede venir de una
 *    compra de hace meses.
 * 3. Recorta a cargos con `expensesToCharges` — la funcion de
 *    `src/lib/expenses/charges.ts`, la misma que usa el dashboard.
 * 4. Agrega segun la metrica.
 */
export async function resolveConsulta(
  client: ConsultaClient,
  query: ConsultaQuery,
  actorId: string,
  householdUserIds: readonly string[],
  onError?: (error: unknown) => void
): Promise<ConsultaAnswer> {
  let materializacionFallida = false;
  for (const { year, month } of mesesDelRango(query.from, query.to)) {
    const { fallo } = await materializeRecurringForMonthSafely(client, year, month, onError ?? (() => {}));
    if (fallo) materializacionFallida = true;
  }

  const where: Record<string, unknown> = { ...visibleExpensesWhere(actorId, householdUserIds) };
  if (query.scope) where.scope = query.scope;
  // Filtro por relacion en vez de resolver categoryName -> categoryId con una
  // consulta aparte: `Category.name` es `@unique` (prisma/schema.prisma), asi
  // que el nombre YA identifica una sola categoria sin necesidad de una
  // segunda ida a la base ni de ensanchar `ConsultaClient` con
  // `category.findFirst`.
  if (query.categoryName) where.category = { name: query.categoryName };

  // Sin filtro de fecha: ver el punto 2 del comentario de arriba.
  const todos = await client.expense.findMany({
    where,
    include: { category: true, installments: { select: { dueDate: true, amount: true } } },
    orderBy: { date: "desc" },
  });

  // Limite EXCLUSIVO superior y limite INCLUSIVO inferior de todo el rango de
  // la consulta, ya normalizados a medianoche. Los usa "tendencia" de abajo
  // para recortar el primer y el ultimo mes exactamente igual que los usan
  // "total" y "por_categoria" mas abajo.
  const desdeRango = inicioDelDia(query.from);
  const hastaRango = diaSiguiente(query.to);

  if (query.metric === "tendencia") {
    const meses = mesesDelRango(query.from, query.to).map(({ year, month }) => {
      // Cada mes CALENDARIO se intersecta con `[desdeRango, hastaRango)`: sin
      // esto, el primer y el ultimo mes de la tendencia ignoraban el recorte a
      // hoy que "total" y "por_categoria" SI respetan (`buildConsulta`,
      // `src/lib/ai/parse.ts`, recorta `to` a hoy si vino en el futuro). Con un
      // gasto cargado a mano con fecha posterior a hoy dentro del mes en curso,
      // el mismo bot contestaba dos numeros distintos para el mismo mes segun
      // la metrica, y el encabezado ("Del ... al ...") describia mal a la
      // tendencia: decia el rango recortado mientras el ultimo mes de la lista
      // no lo respetaba. Los meses intermedios no cambian: sus limites de
      // calendario ya caen adentro del rango.
      const desdeMes = new Date(Date.UTC(year, month - 1, 1));
      const hastaMes = new Date(Date.UTC(year, month, 1));
      const desde = desdeMes > desdeRango ? desdeMes : desdeRango;
      const hasta = hastaMes < hastaRango ? hastaMes : hastaRango;
      const cargosDelMes = expensesToCharges(todos, desde, hasta);
      return { periodo: periodKey(year, month), total: totalDeCargos(cargosDelMes) };
    });
    return { kind: "tendencia", meses, materializacionFallida };
  }

  const cargos = expensesToCharges(todos, desdeRango, hastaRango);

  if (query.metric === "por_categoria") {
    return porCategoria(cargos, materializacionFallida);
  }

  return { kind: "total", total: totalDeCargos(cargos), cantidad: cargos.length, materializacionFallida };
}
