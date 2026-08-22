export type ExpenseScope = "casa" | "personal";

/**
 * Regla de LECTURA. Se usa en toda consulta de gastos: listados, stats,
 * export y las consultas del bot.
 *
 * Los gastos de casa los ven los dos. Los personales los ve unicamente
 * quien los pago (`userId`), NUNCA quien los registro (`createdById`).
 */
export function visibleExpensesWhere(userId: string) {
  return {
    OR: [
      { scope: "casa" },
      { scope: "personal", userId },
    ],
  };
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
