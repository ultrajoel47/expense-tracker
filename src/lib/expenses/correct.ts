import { buildInstallments } from "./installments.ts";
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
 * El minimo de Prisma que este modulo usa, escrito a mano para no importar
 * `@prisma/client` (rompe la pureza y los tests sin bundler). Mismo patron que
 * `src/lib/idempotency.ts`.
 */
export type CorrectClient = {
  expense: {
    findFirst(args: unknown): Promise<CorrectableExpense | null>;
    update(args: unknown): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  installment: {
    deleteMany(args: { where: { expenseId: string } }): Promise<unknown>;
    createMany(args: { data: unknown[] }): Promise<unknown>;
  };
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
    where: { createdById: actorId },
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
 * Borra las cuotas de un gasto y las regenera desde su monto y fecha actuales.
 * Se exporta porque el PUT de la web tiene el mismo agujero y la arreglan las
 * dos con esta.
 */
export async function rebuildInstallments(
  client: Pick<CorrectClient, "installment">,
  expenseId: string,
  date: Date,
  total: number,
  count: number
): Promise<void> {
  await client.installment.deleteMany({ where: { expenseId } });
  const rows = buildInstallments(date, total, count);
  if (rows.length) {
    await client.installment.createMany({
      data: rows.map((r) => ({ ...r, expenseId })),
    });
  }
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
