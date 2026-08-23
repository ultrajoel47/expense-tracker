const MAX_MONTHS_BACK = 6;

/**
 * Convierte lo que devolvio el LLM a un monto en pesos.
 *
 * El caso peligroso es el separador: "12.500" son doce mil quinientos, no
 * doce con cincuenta. La regla es que el punto con tres digitos detras es
 * separador de miles, y la coma siempre es decimal.
 */
export function normalizeAmount(raw: string | number): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }

  const text = raw.trim().toLowerCase();
  if (!text) return null;

  const multiplier = /\b(lucas?|k)\b/.test(text)
    ? 1000
    : /\b(palos?|millon(es)?)\b/.test(text)
      ? 1_000_000
      : 1;

  let numeric = text.replace(/[^\d.,]/g, "");
  if (!numeric) return null;

  // La coma es siempre decimal; el punto es miles cuando lo siguen 3 digitos.
  if (numeric.includes(",")) {
    numeric = numeric.replace(/\./g, "").replace(",", ".");
  } else {
    numeric = numeric.replace(/\.(?=\d{3}(\D|$))/g, "");
  }

  const value = Number(numeric) * multiplier;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Valida la fecha ISO que devolvio el LLM. No interpreta lenguaje natural:
 * eso se resuelve pasandole `today` en el prompt y pidiendole ISO de vuelta.
 */
export function resolveDate(iso: string, today: Date): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;

  const parsed = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  const todayEnd = new Date(today);
  todayEnd.setUTCHours(23, 59, 59, 999);
  if (parsed > todayEnd) return null;

  const floor = new Date(today);
  floor.setUTCMonth(floor.getUTCMonth() - MAX_MONTHS_BACK);
  if (parsed < floor) return null;

  return parsed;
}

/** La fecha de hoy en la zona de negocio, como "YYYY-MM-DD". */
export function todayInBuenosAires(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
