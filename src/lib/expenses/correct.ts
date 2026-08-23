import { buildInstallments, type InstallmentRow } from "./installments.ts";
import type { CorreccionPatch } from "../ai/types.ts";

/** Los campos del Expense que una correccion necesita leer. */
export type CorrectableExpense = {
  id: string;
  amount: number;
  description: string;
  date: Date;
  scope: string;
  userId: string;
  createdById: string;
  categoryId: string;
  totalInstallments: number | null;
  botChatId: string | null;
  botMessageId: string | null;
};

/**
 * El cliente que ve el CUERPO de una transaccion de cuotas: sin
 * `$transaction` (para que no se pueda anidar una transaccion dentro de
 * otra) y con `installment.upsert`, que es lo que permite reconstruir las
 * cuotas preservando `paid`/`paidAt` en vez de borrar y recrear. Ver el
 * comentario de `rebuildInstallments`.
 */
type CorrectTxClient = {
  installment: {
    upsert(args: {
      where: {
        expenseId_installmentNumber: { expenseId: string; installmentNumber: number };
      };
      // La forma de una fila, no `unknown`: `InstallmentRow & { expenseId: string }`
      // es el mismo shape que arma `buildInstallments` (importado de
      // `installments.ts` para no duplicarlo) mas el `expenseId` que le falta.
      create: InstallmentRow & { expenseId: string };
      update: { amount: number; dueDate: Date };
    }): Promise<unknown>;
    deleteMany(args: {
      where: { expenseId: string; installmentNumber?: { gt: number } };
    }): Promise<unknown>;
  };
};

/**
 * El minimo de Prisma que este modulo usa, escrito a mano para no importar
 * `@prisma/client` (rompe la pureza y los tests sin bundler). Mismo patron que
 * `src/lib/idempotency.ts` y que `MaterializeClient` en
 * `src/lib/recurring-materialize.ts`, de donde sale la forma de tipar
 * `$transaction` sin importar el namespace de Prisma.
 */
export type CorrectClient = {
  expense: {
    findFirst(args: unknown): Promise<CorrectableExpense | null>;
    update(args: unknown): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  installment: CorrectTxClient["installment"];
  $transaction<T>(fn: (tx: CorrectTxClient) => Promise<T>): Promise<T>;
};

export type TargetResult =
  | { expense: CorrectableExpense }
  | { expense: null; reason: "reply_desconocido" | "sin_gastos" };

/**
 * A que gasto se refiere una correccion por texto libre.
 *
 * 1. **Reply.** Si el mensaje responde a una confirmacion del bot, el objetivo
 *    es el gasto de ESE mensaje (`botChatId` + `botMessageId`). Es el unico
 *    camino sin ambiguedad y por eso va primero.
 * 2. **Ultimo registrado por quien escribe.** Por `createdById`, **no** por
 *    `userId`: si Virginia carga un gasto que pago Leandro y despues escribe
 *    "eso fue personal", habla del gasto que ELLA acaba de cargar. Buscar por
 *    pagador apuntaria al ultimo gasto de ella, que puede ser otro.
 *
 * **Un reply que no resuelve NO cae al ultimo gasto.** La persona apunto a un
 * mensaje concreto; aplicarle su correccion a otro gasto es corrupcion
 * silenciosa — el riesgo que la seccion 15 del spec nombra como "correccion
 * aplicada al gasto equivocado". Se devuelve el motivo y el bot lo dice.
 */
export async function resolveCorrectionTarget(
  client: CorrectClient,
  actorId: string,
  chatId: string,
  replyToMessageId: string | null
): Promise<TargetResult> {
  if (replyToMessageId) {
    const porReply = await client.expense.findFirst({
      where: { botChatId: chatId, botMessageId: replyToMessageId },
    });
    return porReply ? { expense: porReply } : { expense: null, reason: "reply_desconocido" };
  }

  const ultimo = await client.expense.findFirst({
    // `source: { not: "recurring" }` y no un filtro por `recurringExpenseId`:
    // `source` tiene default y esta siempre presente, asi que el predicado no
    // depende de si Mongo guardo el campo opcional como null o ausente.
    //
    // Una fila materializada NO la registro nadie: la creo una lectura de un
    // mes (`materializeRecurringForMonth` corre en el GET de /api/expenses y
    // de /stats, con `createdById` del dueño de la plantilla y `createdAt` de
    // ese instante). Sin este filtro, abrir el dashboard el primero de mes
    // pone 10 filas nuevas adelante de la cola y el respaldo apunta al
    // alquiler en vez de al ultimo gasto que la persona realmente cargo.
    where: { createdById: actorId, source: { not: "recurring" } },
    orderBy: { createdAt: "desc" },
  });
  return ultimo ? { expense: ultimo } : { expense: null, reason: "sin_gastos" };
}

/** El gasto despues de aplicar el patch, para armar la confirmacion. */
export type CorrectedExpense = {
  amount: number;
  description: string;
  date: Date;
  scope: string;
  categoryId: string;
};

/**
 * Aplica el patch y devuelve el estado resultante.
 *
 * **Las cuotas se reconstruyen cuando cambia el monto o la fecha.** Despues de
 * la Enmienda 1 del spec, un gasto en cuotas cuenta en cada mes por el monto
 * de la cuota que vence ahi, no por el total: si se corrige el monto y las
 * filas de `Installment` quedan con el valor viejo, **la correccion no mueve
 * NINGUN total del dashboard** y el bot igual contesta "listo". Y si cambia la
 * fecha, las cuotas siguen venciendo desde el mes viejo. Es el mismo agujero
 * que tiene hoy el PUT de la web; 2B lo cierra usando esta misma funcion.
 *
 * El permiso NO se chequea aca: es `canEditViaBot` en `src/lib/visibility.ts`,
 * y lo aplica quien llama, antes. Esta funcion escribe.
 */
export async function applyCorrection(
  client: CorrectClient,
  expense: CorrectableExpense,
  patch: CorreccionPatch,
  categories: readonly { id: string; name: string }[]
): Promise<CorrectedExpense> {
  const categoryId = patch.categoryName
    ? (categories.find((c) => c.name === patch.categoryName)?.id ?? expense.categoryId)
    : expense.categoryId;

  const merged: CorrectedExpense = {
    amount: patch.amount ?? expense.amount,
    description: patch.description ?? expense.description,
    date: patch.date ?? expense.date,
    scope: patch.scope ?? expense.scope,
    categoryId,
  };

  await client.expense.update({ where: { id: expense.id }, data: merged });

  const cambioElMonto = merged.amount !== expense.amount;
  const cambioLaFecha = merged.date.getTime() !== expense.date.getTime();
  if (expense.totalInstallments && (cambioElMonto || cambioLaFecha)) {
    await rebuildInstallments(
      client,
      expense.id,
      merged.date,
      merged.amount,
      expense.totalInstallments
    );
  }

  return merged;
}

/**
 * Recalcula las cuotas de un gasto desde su monto y fecha actuales,
 * **preservando `paid` y `paidAt`**.
 *
 * Antes esto borraba y recreaba, y eso destruia el estado de pago de todas las
 * cuotas en el camino feliz: corregir el monto de una compra en 12 cuotas con 5
 * tildadas como pagadas las devolvia a "no pagada" y le sumaba esas 5 a la
 * "Deuda en Tarjetas" del dashboard, sin dejar rastro de que se habia perdido.
 * En la base real, 56 de 66 cuotas estan pagadas: era el caso comun, no el raro.
 *
 * El `update` toca SOLO `amount` y `dueDate` — omitir `paid`/`paidAt` es lo que
 * los conserva, y es deliberado: no los agregues "por completitud".
 *
 * Va en una transaccion porque el estado intermedio es destructivo: un gasto con
 * `totalInstallments > 1` y sin filas de cuota **no aparece en ningun mes**
 * (`expensesToCharges` no emite ningun cargo para el), o sea plata que existe y
 * no se cuenta en ningun total. Ver el comentario de cabecera de
 * `buildInstallments`, que ya nombra ese modo de falla.
 *
 * Se exporta porque el PUT de la web (`src/app/api/expenses/[id]/route.ts`) no
 * tiene su propia transaccion abierta: esta es la que la abre para el.
 */
export async function rebuildInstallments(
  client: Pick<CorrectClient, "$transaction">,
  expenseId: string,
  date: Date,
  total: number,
  count: number
): Promise<void> {
  const rows = buildInstallments(date, total, count);

  await client.$transaction(async (tx) => {
    for (const row of rows) {
      await tx.installment.upsert({
        where: {
          expenseId_installmentNumber: {
            expenseId,
            installmentNumber: row.installmentNumber,
          },
        },
        create: { ...row, expenseId },
        update: { amount: row.amount, dueDate: row.dueDate },
      });
    }

    // Si el gasto quedo con menos cuotas que antes, sobran filas. Con
    // `rows.length === 0` (un gasto que dejo de ser en cuotas) esto borra
    // todas, porque los numeros empiezan en 1.
    await tx.installment.deleteMany({
      where: { expenseId, installmentNumber: { gt: rows.length } },
    });
  });
}

/**
 * Borra un gasto y sus cuotas. Mongo no tiene cascade: sin el deleteMany, las
 * filas de `Installment` quedan huerfanas apuntando a un gasto inexistente.
 * Mismo orden que el DELETE de la web (`src/app/api/expenses/[id]/route.ts`).
 */
export async function deleteExpenseWithInstallments(
  client: CorrectClient,
  expenseId: string
): Promise<void> {
  await client.installment.deleteMany({ where: { expenseId } });
  await client.expense.delete({ where: { id: expenseId } });
}
