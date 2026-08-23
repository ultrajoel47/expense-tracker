import { formatArs } from "../format.ts";

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

/** El mismo formato `dd/MM` (zona horaria de Buenos Aires) que usa
 * `buildConfirmation`, extraido para que `describeChanges` no duplique el
 * `Intl.DateTimeFormat`. */
function formatFechaCorta(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

/**
 * Los campos que cambiaron, como "antes → despues", para la confirmacion de una
 * correccion.
 *
 * Existe porque una correccion es la unica operacion DESTRUCTIVA que el bot
 * hace sin pedir confirmacion: pisa un valor y el anterior no queda en ningun
 * lado (no hay historial ni auditoria), y el teclado solo puede revertir ambito
 * y categoria. Mostrar el valor viejo no previene el error, pero lo deja
 * escrito en el chat: con eso, una correccion aplicada al gasto equivocado se
 * ve y se puede desarmar a mano.
 */
export function describeChanges(
  antes: { amount: number; description: string; date: Date; scope: string; categoryName: string },
  despues: { amount: number; description: string; date: Date; scope: string; categoryName: string }
): string[] {
  const lines: string[] = [];

  if (antes.amount !== despues.amount) {
    lines.push(`monto: ${formatArs(antes.amount)} → ${formatArs(despues.amount)}`);
  }

  if (antes.description !== despues.description) {
    lines.push(`descripcion: ${antes.description} → ${despues.description}`);
  }

  if (antes.date.getTime() !== despues.date.getTime()) {
    const fechaAntes = formatFechaCorta(antes.date);
    const fechaDespues = formatFechaCorta(despues.date);
    // Mismo dia, distinta hora: la confirmacion habla de dias (dd/MM), asi
    // que mostrar un "cambio" que no se ve en el texto confundiria mas de lo
    // que aclara.
    if (fechaAntes !== fechaDespues) {
      lines.push(`fecha: ${fechaAntes} → ${fechaDespues}`);
    }
  }

  if (antes.scope !== despues.scope) {
    lines.push(`ambito: ${antes.scope} → ${despues.scope}`);
  }

  if (antes.categoryName !== despues.categoryName) {
    lines.push(`categoria: ${antes.categoryName} → ${despues.categoryName}`);
  }

  return lines;
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
  /**
   * True cuando el mensaje confirma una CORRECCION y no un alta. Cambia el
   * glifo de la primera linea: un "✓" en una correccion se lee como un gasto
   * nuevo, y en una app de gastos "aparecio otro gasto" y "cambio el que ya
   * estaba" no pueden verse igual.
   */
  corregido?: boolean;
  /**
   * Los cambios de una correccion, como "antes → despues". Se renderizan
   * debajo de las dos lineas del gasto. Ver `describeChanges`.
   */
  cambios?: string[];
}): string {
  const fecha = formatFechaCorta(e.date);

  const lines = [
    `${e.corregido ? "✏" : "✓"} <b>${formatArs(e.amount)}</b> · ${e.description}`,
    `${e.categoryName} · ${e.scope} · pago ${e.payerName} · ${fecha}` +
      (e.cardName ? ` · ${e.cardName}` : ""),
  ];

  if (e.cambios?.length) {
    for (const cambio of e.cambios) lines.push(`↺ ${cambio}`);
  }

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
