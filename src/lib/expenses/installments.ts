export type InstallmentRow = {
  installmentNumber: number;
  dueDate: Date;
  amount: number;
};

/**
 * Las filas de `Installment` de un gasto en cuotas.
 *
 * Existia inline y duplicada en el POST de la web y en el webhook del bot, sin
 * un solo test — y es la aritmetica que puede hacer DESAPARECER un gasto: el
 * `GET /api/expenses` selecciona los gastos en cuotas por
 * `installments: { some: { dueDate } }`, asi que un gasto con
 * `totalInstallments: 3` y sin filas no aparece en ningun mes.
 *
 * Dos cosas que la version inline hacia mal:
 *
 *  - Usaba `due.setMonth(due.getMonth() + i)` sobre un `Date`. Para una compra
 *    el 31, "31 de febrero" se normaliza hacia marzo, asi que febrero quedaba
 *    sin cuota y marzo con dos. Aca se construye la fecha desde el año y el mes
 *    en UTC, fijando el dia 1, que no puede desbordar.
 *  - Dividia `total / count` sin redondear, asi que las cuotas no sumaban el
 *    total. Aca se redondea a centavos y el resto va en la ultima.
 */
export function buildInstallments(
  purchaseDate: Date,
  total: number,
  count: number
): InstallmentRow[] {
  if (!Number.isInteger(count) || count <= 1) return [];

  const y = purchaseDate.getUTCFullYear();
  const m = purchaseDate.getUTCMonth();

  const base = Math.round((total / count) * 100) / 100;
  const rows: InstallmentRow[] = [];

  for (let i = 0; i < count; i++) {
    const esUltima = i === count - 1;
    const amount = esUltima
      ? Math.round((total - base * (count - 1)) * 100) / 100
      : base;

    rows.push({
      installmentNumber: i + 1,
      // Dia 1 a mediodia UTC: no puede desbordar de mes ni cambiar de dia por
      // zona horaria. El dia exacto del vencimiento no se usa en ningun
      // filtro; todos los filtros son por mes.
      dueDate: new Date(Date.UTC(y, m + i, 1, 12, 0, 0)),
      amount,
    });
  }

  return rows;
}
