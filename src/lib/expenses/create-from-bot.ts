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

export function buildConfirmation(e: {
  amount: number;
  description: string;
  categoryName: string;
  scope: string;
  payerName: string;
  date: Date;
  anomalous: boolean;
}): string {
  const fecha = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
  }).format(e.date);

  const lines = [
    `✓ <b>${formatArs(e.amount)}</b> · ${e.description}`,
    `${e.categoryName} · ${e.scope} · pago ${e.payerName} · ${fecha}`,
  ];

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
