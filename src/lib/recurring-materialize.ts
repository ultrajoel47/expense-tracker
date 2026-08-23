export type MaterializeTemplate = {
  id: string;
  userId: string;
  categoryId: string;
  creditCardId: string | null;
  amount: number;
  description: string;
  frequency: string;
  scope: string;
  active: boolean;
  createdAt: Date;
};

type Tx = {
  expense: {
    findFirst(args: { where: { recurringExpenseId: string; recurringPeriod: string } }): Promise<unknown | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export type MaterializeClient = {
  recurringExpense: { findMany(args: unknown): Promise<MaterializeTemplate[]> };
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
};

/** La clave de idempotencia de un periodo: "2026-03". */
export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Primer mes que esta funcionalidad puede materializar, como clave de periodo.
 *
 * POR QUE UN MES FIJO Y NO `plantilla.createdAt`: las 10 plantillas reales se
 * crearon todas en 2026-03, pero marzo, abril, mayo, junio y julio de 2026 YA
 * CONTIENEN el alquiler, los servicios, el seguro y la cochera cargados A MANO
 * como gastos comunes (marzo 2026 tiene 69 gastos reales y llega a $2.301.704
 * sin una sola fila materializada). Derivar el piso de `createdAt` haria que un
 * click en la flecha "←" del dashboard materializara esos cinco meses y
 * DUPLICARA el alquiler: unos cinco millones de pesos fantasma.
 *
 * Este mes es el mes en que la materializacion automatica entro en vigencia:
 * el primero en el que los recurrentes NO se cargaron a mano. Si alguien lo
 * "mejora" volviendo a `createdAt`, reintroduce el doble conteo.
 *
 * El guard de `createdAt` sigue existiendo y es complementario: cubre las
 * plantillas creadas DESPUES del piso, que no deben materializar meses
 * anteriores a su propia existencia.
 */
export const PRIMER_PERIODO_MATERIALIZABLE = "2026-08";

/**
 * Verdadero si el mes pedido esta dentro de la ventana materializable:
 *
 * - PISO: `PRIMER_PERIODO_MATERIALIZABLE` (ver arriba).
 * - TECHO: el mes actual. Un mes que todavia no paso no puede tener gastos, y
 *   materializarlo congelaria el monto que la plantilla tiene HOY — que es el
 *   monto equivocado en cuanto el alquiler se indexa.
 *
 * Se compara con los strings de `periodKey`, no con numeros: el mes viene con
 * dos digitos y el año con cuatro, asi que el orden lexicografico es el orden
 * cronologico PARA MESES VALIDOS (1-12). Un mes fuera de ese rango no queda
 * rechazado por la comparacion de strings: por ejemplo mes 13 -> "2026-13" es
 * lexicograficamente MAYOR que el piso "2026-08" pero tambien MENOR que
 * "2027-01", asi que en cuanto el techo llegue a 2027 esa clave cae DENTRO de
 * la ventana en vez de por encima. Esa clave no colisiona con la de enero de
 * 2027 ("2027-01"), asi que el alquiler de ese mes se crearia dos veces. Por
 * eso el mes se valida por RANGO antes de armar la clave, no despues.
 *
 * `hoy` es un parametro para que los tests puedan fijar el techo; en
 * produccion se usa el reloj. Se lee en hora local, igual que el resto del
 * repo (`new Date().getMonth() + 1` en los route handlers).
 */
export function esPeriodoMaterializable(
  year: number,
  month: number,
  hoy: Date = new Date()
): boolean {
  // Un mes fuera de 1-12 produce una clave que puede caer DENTRO de la ventana
  // en un año futuro ("2026-13" es >= "2026-08" y < "2027-01"), y esa clave no
  // colisiona con "2027-01", asi que el alquiler se crearia dos veces en el mismo
  // mes real. La comparacion de strings no puede detectarlo: hay que rechazar el
  // mes por rango, antes de construir la clave.
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;

  const periodo = periodKey(year, month);
  if (periodo < PRIMER_PERIODO_MATERIALIZABLE) return false;
  if (periodo > periodKey(hoy.getFullYear(), hoy.getMonth() + 1)) return false;
  return true;
}

/**
 * Verdadero si el error es la violacion de restriccion unica de Prisma
 * (P2002), sin importar el namespace de Prisma para no romper la pureza
 * de este modulo. Mismo patron que `isDuplicateKeyError` en
 * `src/lib/idempotency.ts`. Cualquier otro error (timeout, caida de
 * conexion, failover del replica set) no es una duplicacion: es un fallo
 * real que hay que propagar.
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
 * Crea los `Expense` que faltan para las plantillas mensuales activas en el
 * mes pedido. Devuelve cuantos creo.
 *
 * VENTANA TEMPORAL: solo materializa entre `PRIMER_PERIODO_MATERIALIZABLE` y
 * el mes actual, inclusive (ver `esPeriodoMaterializable`). Fuera de esa
 * ventana no crea nada y devuelve 0. Esto es lo que impide que navegar con las
 * flechas del dashboard escriba gastos: "→" a un mes futuro inventaria un
 * alquiler que nadie pago, "←" a un mes anterior al piso duplicaria el que ya
 * esta cargado a mano.
 *
 * Por que materializar como `Expense` y no como un modelo aparte: la Rebanada 1
 * borro `RecurringExpensePeriod` porque su unico consumidor era el motor de
 * balance. Con los recurrentes como `Expense`, entran en los mismos cargos que
 * todo lo demas y los graficos los cuentan sin ninguna rama especial. Antes de
 * esto los 10 recurrentes del usuario no aparecian en ningun total: el alquiler
 * no estaba en el total del mes.
 *
 * IDEMPOTENCIA: `findFirst` por (`recurringExpenseId`, `recurringPeriod`) dentro
 * de una transaccion, que es el patron que ya venia funcionando en este repo.
 * En Mongo NO se puede declarar el `@@unique` de esos dos campos en Prisma: el
 * indice unico trataria el campo ausente como `null` y todos los gastos
 * manuales — que tienen los dos vacios — colisionarian entre si. El indice
 * unico PARCIAL que si sirve esta creado a mano en la base
 * (`Expense_recurring_period_unique_partial`) y es la red de seguridad; ver
 * `docs/data-models.md`.
 *
 * El `findFirst` es una optimizacion, no la garantia: en una app de dos
 * personas, dos lecturas concurrentes (los dos integrantes del hogar
 * abriendo el dashboard a la vez) pueden pasar ambas el `findFirst` bajo
 * snapshot isolation y las dos intentar el `create`. La que pierde la
 * carrera choca con el indice unico parcial y Prisma tira P2002 — eso se
 * trata como "ya lo creo el otro" (no cuenta, no se relanza) y se sigue con
 * la siguiente plantilla. Cualquier otro error SI se relanza: tratar un
 * fallo transitorio como "ya existe" haria que el alquiler dejara de
 * aparecer en silencio, que es peor que un 500.
 */
export async function materializeRecurringForMonth(
  client: MaterializeClient,
  year: number,
  month: number
): Promise<number> {
  // Los limites viven ACA, no en los call sites: los dos route handlers pasan
  // el mes que llega del query string y cualquier llamador futuro hereda la
  // ventana sin tener que acordarse de nada.
  if (!esPeriodoMaterializable(year, month)) return 0;

  const periodo = periodKey(year, month);
  const finDelMes = new Date(Date.UTC(year, month, 1));

  const plantillas = await client.recurringExpense.findMany({
    where: { active: true, frequency: "MONTHLY" },
  });

  let creados = 0;

  for (const t of plantillas) {
    // No inventar un periodo anterior a la existencia de la plantilla.
    if (t.createdAt >= finDelMes) continue;

    let creado: boolean;
    try {
      creado = await client.$transaction(async (tx) => {
        const ya = await tx.expense.findFirst({
          where: { recurringExpenseId: t.id, recurringPeriod: periodo },
        });
        if (ya) return false;

        await tx.expense.create({
          data: {
            amount: t.amount,
            description: t.description,
            // Dia 1 a mediodia UTC: cae dentro del mes en cualquier zona.
            date: new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)),
            categoryId: t.categoryId,
            creditCardId: t.creditCardId,
            userId: t.userId,
            createdById: t.userId,
            scope: t.scope,
            source: "recurring",
            recurringExpenseId: t.id,
            recurringPeriod: periodo,
          },
        });
        return true;
      });
    } catch (error) {
      // Otra lectura concurrente gano la carrera y ya lo creo: no es una
      // falla, es el indice unico parcial haciendo su trabajo. Seguir con
      // la proxima plantilla en vez de abandonar el resto del lote.
      if (isDuplicateKeyError(error)) continue;
      throw error;
    }

    if (creado) creados++;
  }

  return creados;
}
