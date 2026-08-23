const ANOMALY_FACTOR = 10;

/**
 * Techo absoluto de sensatez, independiente de cualquier historial.
 *
 * `isAnomalous` solo compara contra el promedio de la categoria, asi que una
 * categoria sin gastos previos (categoryAverage === null) queda sin ninguna
 * red: su primer gasto pasa sin importar la magnitud. Hoy eso es alcanzable,
 * no hipotetico — "Educacion" tiene 0 gastos.
 *
 * El valor se eligio mirando los 386 gastos reales: el promedio general es
 * ~$30.700, el promedio por categoria va de ~$13.500 (Entretenimiento) a
 * ~$145.700 (Servicios), y el gasto individual mas grande jamas cargado es
 * $458.806 (bebidas, categoria Otros; el resto de los outliers son muebles y
 * electrodomesticos grandes entre $250.000 y $390.000, varios en cuotas).
 * $2.000.000 ("2 palos") queda mas de 4x por encima de ese maximo real, asi
 * que no se dispara con ninguna compra grande legitima ya vista (heladera,
 * televisor, aspiradora), pero si agarra un gasto ordenes de magnitud fuera
 * de lo que esta pareja gasta en un solo item.
 */
const ABSOLUTE_CEILING = 2_000_000;

export function formatArs(amount: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Normaliza un nombre de tarjeta para comparar: minusculas, sin acentos, sin
 * espacios de sobra. "BBVA Crédito" y "bbva credito" tienen que matchear.
 */
function normalizeCardName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resuelve el nombre de tarjeta que dijo la IA contra las tarjetas reales del
 * pagador. Devuelve `null` si no matchea ninguna.
 *
 * `cardName` viene del mensaje de la persona, no de un selector: dice "con la
 * visa" o "con la bbva", casi nunca el nombre exacto de la fila. Por eso
 * despues del match exacto se prueban las dos direcciones de `contains`:
 * "visa" contra "Visa Galicia", y "mercado pago debito" contra "Mercado pago".
 * El match exacto va primero para que un nombre completo no lo gane una
 * coincidencia parcial de otra tarjeta.
 *
 * Si dos tarjetas matchean parcialmente se toma la primera: es ambiguo por
 * naturaleza y el usuario lo corrige en la web (la confirmacion dice cual se
 * eligio).
 */
export function resolveCard<T extends { id: string; name: string }>(
  cardName: string | null | undefined,
  cards: readonly T[]
): T | null {
  if (!cardName) return null;
  const needle = normalizeCardName(cardName);
  if (!needle) return null;

  return (
    cards.find((c) => normalizeCardName(c.name) === needle) ??
    cards.find((c) => normalizeCardName(c.name).includes(needle)) ??
    cards.find((c) => needle.includes(normalizeCardName(c.name))) ??
    null
  );
}

export function buildConfirmation(e: {
  amount: number;
  description: string;
  categoryName: string;
  scope: string;
  payerName: string;
  date: Date;
  anomalous: boolean;
  /** Nombre de la tarjeta que quedo asociada, o null si el gasto no tiene. */
  cardName?: string | null;
  /**
   * Nombre de tarjeta que la persona dijo y que NO matcheo ninguna suya. El
   * gasto se guarda igual, sin tarjeta, pero hay que decirlo: si no, la compra
   * queda fuera de la deuda de tarjetas y de la pagina de tarjetas sin que
   * nadie se entere.
   */
  unmatchedCardName?: string | null;
}): string {
  const fecha = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
  }).format(e.date);

  const lines = [
    `✓ <b>${formatArs(e.amount)}</b> · ${e.description}`,
    `${e.categoryName} · ${e.scope} · pago ${e.payerName} · ${fecha}` +
      (e.cardName ? ` · ${e.cardName}` : ""),
  ];

  if (e.unmatchedCardName) {
    lines.push(
      `⚠ No encontre una tarjeta tuya que se parezca a "${e.unmatchedCardName}", ` +
        "asi que el gasto quedo SIN tarjeta. Asignala en la web."
    );
  }

  if (e.anomalous) {
    lines.push("⚠ El monto es muy alto para esta categoria, revisa que este bien.");
  }

  return lines.join("\n");
}

/**
 * Un monto es anomalo si:
 *  (a) supera por mucho (10x) el promedio historico de su categoria, o
 *  (b) supera el techo absoluto de sensatez, tenga o no historial.
 *
 * (b) existe porque (a) sola deja sin proteccion a cualquier categoria sin
 * gastos previos: `categoryAverage === null` hacia que la funcion devolviera
 * `false` siempre, asi que el primer gasto de una categoria vacia pasaba sin
 * advertencia sin importar la magnitud. Las dos senales se complementan: la
 * relativa agarra un monto raro para ESTA categoria (unas medialunas por
 * $80.000 en Alimentacion, con promedio de $22.000), y la absoluta agarra un
 * disparate sin importar la categoria, incluida la que todavia no tiene
 * ningun gasto.
 *
 * Se guarda igual: la senal reemplaza a un tap de confirmacion, no bloquea
 * la carga.
 */
export function isAnomalous(amount: number, categoryAverage: number | null): boolean {
  if (amount > ABSOLUTE_CEILING) return true;
  if (categoryAverage === null || categoryAverage <= 0) return false;
  return amount > categoryAverage * ANOMALY_FACTOR;
}
