export type Charge = {
  date: Date;
  amount: number;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  expenseId: string;
};

export type ChargeableExpense = {
  id: string;
  amount: number;
  date: Date;
  totalInstallments: number | null;
  category: { id: string; name: string; color: string };
  installments: { dueDate: Date; amount: number }[];
};

/**
 * Convierte gastos en CARGOS: lo que efectivamente se paga dentro de
 * `[from, to)`.
 *
 * Es la Enmienda 1 del spec hecha codigo. La Rebanada 1 dejo las dos rutas de
 * lectura en desacuerdo — el listado contaba una compra en cuotas en cada mes
 * que vencia una cuota, los graficos la contaban entera en el mes de la compra
 * — asi que el mismo mes daba dos totales y no habia forma de reconciliarlos.
 *
 * La regla, unica para las dos rutas:
 *
 *  - Sin cuotas (`totalInstallments` nulo o <= 1): un cargo por el monto del
 *    gasto, en la fecha del gasto.
 *  - En cuotas: un cargo por cada cuota que vence en el rango, por el monto de
 *    LA CUOTA, en la fecha de vencimiento. Nunca por el monto total, y nunca en
 *    el mes de la compra.
 *
 * `from` es inclusivo y `to` exclusivo, igual que los rangos de mes que ya usan
 * las routes (`Date.UTC(year, month - 1, 1)` a `Date.UTC(year, month, 1)`).
 */
export function expensesToCharges(
  expenses: ChargeableExpense[],
  from: Date,
  to: Date
): Charge[] {
  const charges: Charge[] = [];

  for (const e of expenses) {
    const enCuotas = e.totalInstallments !== null && e.totalInstallments > 1;

    if (!enCuotas) {
      if (e.date >= from && e.date < to) {
        charges.push({
          date: e.date,
          amount: e.amount,
          categoryId: e.category.id,
          categoryName: e.category.name,
          categoryColor: e.category.color,
          expenseId: e.id,
        });
      }
      continue;
    }

    for (const cuota of e.installments) {
      if (cuota.dueDate >= from && cuota.dueDate < to) {
        charges.push({
          date: cuota.dueDate,
          amount: cuota.amount,
          categoryId: e.category.id,
          categoryName: e.category.name,
          categoryColor: e.category.color,
          expenseId: e.id,
        });
      }
    }
  }

  return charges;
}
