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
