/**
 * Formats a number as currency in Argentine Spanish format.
 * Example: 1650000.32 → "1.650.000,32"
 */
export function formatCurrency(amount: number): string {
  return amount.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
