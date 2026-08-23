export type ExpenseScope = "casa" | "personal";

/**
 * El modelo de privacidad tiene DOS mitades, y las dos viven en este archivo:
 *
 *  1. QUE ve un miembro del hogar   -> `visibleExpensesWhere` y compania.
 *  2. QUIEN es miembro del hogar    -> `householdPolicy` / `isHouseholdEmail`.
 *
 * La version original de este modulo especificaba solo la primera: la rama de
 * `scope: "casa"` no tenia NINGUN predicado de identidad, asi que cualquier
 * principal autenticado era, de hecho, miembro del hogar. Combinado con un
 * `POST /api/auth/register` abierto, un desconocido que se registraba leia
 * (y podia editar y borrar) todo el historial financiero del hogar.
 *
 * Este modulo es PURO a proposito: sin `@/`, sin `next/*`, sin
 * `@prisma/client`, sin I/O. Se testea con `node --test` sin base de datos.
 * La consecuencia es que NO puede resolver por si mismo quienes son los
 * miembros: el llamador tiene que pasarle los ids (ver
 * `getHouseholdUserIds()` en `src/lib/household.ts`, que es el unico lugar
 * que toca la base y el env). Se prefirio eso a hacer el modulo asincrono:
 * la regla de visibilidad es la pieza mas critica del sistema y tiene que
 * seguir siendo trivialmente testeable.
 */

// ─── Mitad 2: quien es miembro del hogar ────────────────────────────────────

/**
 * Politica de membresia resuelta.
 *
 * - `emails`: la allowlist normalizada (minusculas, sin espacios).
 * - `allowAny`: true solo en el modo permisivo de desarrollo, cuando la
 *   variable de entorno no esta definida. En produccion NUNCA es true.
 */
export type HouseholdPolicy = {
  emails: string[];
  allowAny: boolean;
};

/**
 * Resuelve la politica a partir del valor CRUDO de la variable de entorno
 * (`HOUSEHOLD_EMAILS`) y del entorno de ejecucion (`NODE_ENV`).
 *
 * Decision deliberada sobre la variable AUSENTE, que es el caso interesante:
 *
 *  - En produccion se FALLA CERRADO: `{ emails: [], allowAny: false }`. Nadie
 *    puede registrarse y nadie es miembro (nadie ve los gastos de casa). Un
 *    default permisivo seria exactamente el agujero que esta funcion existe
 *    para tapar, y un olvido de configuracion en un dominio publico no puede
 *    resolverse a favor del atacante. Falla ruidoso, no en silencio: el
 *    llamador loguea (ver `src/lib/household.ts`).
 *  - Fuera de produccion se ABRE: `{ allowAny: true }`. Cerrar tambien acá
 *    dejaria el desarrollo local sin poder registrar el primer usuario ni ver
 *    un solo gasto, con la app aparentemente vacia y sin ninguna pista.
 *
 * O sea: el riesgo se mide por entorno, no por conveniencia.
 */
export function householdPolicy(
  raw: string | undefined | null,
  nodeEnv: string | undefined | null
): HouseholdPolicy {
  const emails = (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  if (emails.length > 0) return { emails, allowAny: false };

  // Variable ausente o vacia.
  return { emails: [], allowAny: nodeEnv !== "production" };
}

/** True si `email` esta habilitado por la politica. Case/space-insensitive. */
export function isHouseholdEmail(email: string, policy: HouseholdPolicy): boolean {
  if (policy.allowAny) return true;
  return policy.emails.includes(email.trim().toLowerCase());
}

// ─── Mitad 1: que ve un miembro del hogar ───────────────────────────────────

/**
 * Regla de LECTURA compartida por cualquier modelo con forma `{ scope, userId }`
 * (hoy: Expense y RecurringExpense). No usar directamente fuera de este
 * archivo: cada modelo tiene su propio export tipado abajo para que el
 * nombre en el call site diga a que entidad aplica.
 *
 * Los registros de casa los ven los dos MIEMBROS DEL HOGAR. Los personales
 * los ve unicamente quien los paga (`userId`), NUNCA quien los registro
 * (`createdById`).
 *
 * `householdUserIds` acota la rama de casa por los dos extremos:
 *  - Si el lector no es miembro, no hay rama de casa: solo ve lo propio
 *    (que, con el registro cerrado, es nada).
 *  - Si lo es, la rama de casa solo alcanza registros PAGADOS por un miembro.
 *    Un tercero que hubiera quedado con sesion no puede inyectar filas
 *    visibles a los dueños de la casa.
 */
function scopedVisibilityWhere(userId: string, householdUserIds: readonly string[]) {
  const own = { scope: "personal", userId };

  if (!householdUserIds.includes(userId)) {
    // Se mantiene la forma `{ OR: [...] }` incluso con una sola rama: varias
    // rutas construyen el resto del filtro asumiendo que `OR` esta ocupado
    // por la visibilidad y que lo suyo va en `AND`.
    return { OR: [own] };
  }

  return {
    OR: [
      { scope: "casa", userId: { in: [...householdUserIds] } },
      own,
    ],
  };
}

/**
 * Regla de LECTURA. Se usa en toda consulta de gastos: listados, stats,
 * export, las cuotas de un gasto y las consultas del bot.
 *
 * `householdUserIds` viene de `getHouseholdUserIds()` (`src/lib/household.ts`).
 */
export function visibleExpensesWhere(userId: string, householdUserIds: readonly string[]) {
  return scopedVisibilityWhere(userId, householdUserIds);
}

/**
 * Regla de LECTURA para gastos recurrentes. Misma regla que
 * `visibleExpensesWhere` (RecurringExpense tiene `scope` y `userId` con el
 * mismo significado): los recurrentes de casa los ven los miembros, los
 * personales solo quien los paga.
 */
export function visibleRecurringExpensesWhere(
  userId: string,
  householdUserIds: readonly string[]
) {
  return scopedVisibilityWhere(userId, householdUserIds);
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
