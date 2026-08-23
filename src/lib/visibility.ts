export type ExpenseScope = "casa" | "personal";

/**
 * Regla de LECTURA compartida por cualquier modelo con forma `{ scope, userId }`
 * (hoy: Expense y RecurringExpense). No usar directamente fuera de este
 * archivo: cada modelo tiene su propio export tipado abajo para que el
 * nombre en el call site diga a que entidad aplica.
 *
 * Los registros de casa los ven los dos. Los personales los ve unicamente
 * quien los paga (`userId`), NUNCA quien los registro (`createdById`).
 */
function scopedVisibilityWhere(userId: string) {
  return {
    OR: [
      { scope: "casa" },
      { scope: "personal", userId },
    ],
  };
}

/**
 * Regla de LECTURA. Se usa en toda consulta de gastos: listados, stats,
 * export, las cuotas de un gasto y las consultas del bot.
 *
 * Los gastos de casa los ven los dos. Los personales los ve unicamente
 * quien los pago (`userId`), NUNCA quien los registro (`createdById`).
 */
export function visibleExpensesWhere(userId: string) {
  return scopedVisibilityWhere(userId);
}

/**
 * Regla de LECTURA para gastos recurrentes. Misma regla que
 * `visibleExpensesWhere` (RecurringExpense tiene `scope` y `userId` con el
 * mismo significado): los recurrentes de casa los ven los dos, los
 * personales solo quien los paga.
 */
export function visibleRecurringExpensesWhere(userId: string) {
  return scopedVisibilityWhere(userId);
}

/**
 * Permiso de EDICION via el bot. Deliberadamente mas amplio que la lectura:
 * quien registro un gasto puede corregir una carga mal hecha desde el mensaje
 * de confirmacion que quedo en su chat, aunque no pueda verlo en la web.
 *
 * No unificar con visibleExpensesWhere: si se usa este permiso para leer, se
 * filtran gastos personales.
 */
export function canEditViaBot(
  expense: { userId: string; createdById: string },
  actorId: string
): boolean {
  return expense.userId === actorId || expense.createdById === actorId;
}
