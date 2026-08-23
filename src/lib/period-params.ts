/**
 * Parseo y validacion del par `month`/`year` que llega por query string a las
 * lecturas de gastos.
 *
 * POR QUE EXISTE: estos dos numeros no solo filtran la lectura, tambien
 * alimentan `materializeRecurringForMonth`, que ESCRIBE. Sin validar:
 *
 * - `?month=13&year=2026` daba la clave de idempotencia "2026-13" con una fila
 *   fechada 2027-01-01. Esa clave no choca con "2027-01", asi que cuando enero
 *   de 2027 se visitara de verdad, el alquiler se creaba UNA SEGUNDA VEZ en el
 *   mismo mes real. El indice unico parcial hecho a mano no lo puede atrapar:
 *   las claves son distintas.
 * - `?month=abc` daba `NaN`, clave "NaN-NaN" e `Invalid Date`. Prisma tiraba un
 *   error que no es P2002, el modulo lo relanzaba (correctamente) y el listado
 *   de gastos devolvia 500 por un parametro mal escrito.
 *
 * Modulo puro a proposito: sin `@/`, sin `next/*`, sin Prisma. Los route
 * handlers traducen el `error` a `{ error }` con status 400.
 */

/** Rango de años aceptado. Suficientemente ancho para el historial real y
 * suficientemente angosto para que no entre un año de cuatro digitos absurdo. */
export const ANIO_MINIMO = 2000;
export const ANIO_MAXIMO = 2100;

export type PeriodoPedido =
  | {
      ok: true;
      year: number;
      month: number;
      /** Verdadero si vinieron los DOS parametros en el query string. Las
       * lecturas usan esto para decidir si aplican el filtro por rango de
       * fechas, que es el comportamiento que ya tenian. */
      explicito: boolean;
    }
  | { ok: false; error: string };

/** Solo digitos: rechaza "3.5", "0x3", "+3", "1e1", " " y "abc", que `Number`
 * aceptaria o convertiria en `NaN` en silencio. */
const SOLO_DIGITOS = /^\d+$/;

function parseEntero(raw: string): number | null {
  const limpio = raw.trim();
  if (!SOLO_DIGITOS.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Un parametro ausente (o vacio) cae al mes actual, que es el comportamiento
 * que ya tenian las dos rutas y del que dependen los listados sin filtro.
 */
export function parsePeriodParams(
  monthRaw: string | null,
  yearRaw: string | null,
  hoy: Date = new Date()
): PeriodoPedido {
  const mesPresente = monthRaw !== null && monthRaw.trim() !== "";
  const anioPresente = yearRaw !== null && yearRaw.trim() !== "";

  let month = hoy.getMonth() + 1;
  if (mesPresente) {
    const n = parseEntero(monthRaw as string);
    if (n === null || n < 1 || n > 12) {
      return { ok: false, error: "El mes debe ser un numero entero entre 1 y 12" };
    }
    month = n;
  }

  let year = hoy.getFullYear();
  if (anioPresente) {
    const n = parseEntero(yearRaw as string);
    if (n === null || n < ANIO_MINIMO || n > ANIO_MAXIMO) {
      return {
        ok: false,
        error: `El año debe ser un numero entero entre ${ANIO_MINIMO} y ${ANIO_MAXIMO}`,
      };
    }
    year = n;
  }

  return { ok: true, year, month, explicito: mesPresente && anioPresente };
}
