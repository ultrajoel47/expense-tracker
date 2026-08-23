import { prisma } from "@/lib/prisma";
import { householdPolicy, isHouseholdEmail, type HouseholdPolicy } from "@/lib/visibility";

/**
 * Quienes son los miembros del hogar. Es la mitad del modelo de privacidad
 * que el diseño original no especificaba (ver el comentario de cabecera de
 * `src/lib/visibility.ts`).
 *
 * **Fuente unica de verdad: la variable de entorno `HOUSEHOLD_EMAILS`.**
 * De ahi salen las DOS decisiones — quien puede registrarse y de quien se
 * ven los gastos de casa — asi que no pueden divergir. Se descarto poner un
 * flag `isMember` en el modelo `User` justamente por eso: seria un segundo
 * lugar donde vive la misma verdad, editable por una ruta de la app, y con
 * un estado inconsistente posible (habilitado para registrarse pero no
 * miembro, o al revés). Los ids se DERIVAN de los emails con una consulta;
 * no se guardan en ningun lado.
 *
 * Este modulo es el unico que toca `process.env` y la base para esto. La
 * politica en si es pura y vive en `visibility.ts`, para poder testearla.
 */

let warnedAboutMissingEnv = false;

/** La politica vigente, leida del entorno. */
export function currentHouseholdPolicy(): HouseholdPolicy {
  const raw = process.env.HOUSEHOLD_EMAILS;
  const policy = householdPolicy(raw, process.env.NODE_ENV);

  if (policy.emails.length === 0 && !policy.allowAny && !warnedAboutMissingEnv) {
    warnedAboutMissingEnv = true;
    console.error(
      "HOUSEHOLD_EMAILS no esta configurada y NODE_ENV es production: se falla " +
        "CERRADO. Nadie puede registrarse y nadie es miembro del hogar, asi que " +
        "no se ven los gastos de casa. Configurar la variable con los emails del " +
        "hogar separados por coma."
    );
  }

  return policy;
}

/** True si ese email esta habilitado a tener cuenta en esta instalacion. */
export function isHouseholdMemberEmail(email: string): boolean {
  return isHouseholdEmail(email, currentHouseholdPolicy());
}

/**
 * Los ids de los usuarios que son miembros del hogar.
 *
 * El filtrado se hace en JS y no con un `where: { email: { in: [...] } }` a
 * proposito: la comparacion de Mongo es case-sensitive y el registro guarda
 * el email tal como lo escribio la persona, asi que un `Leandro@x.com` en la
 * base y un `leandro@x.com` en la allowlist no matchearian — y el sintoma
 * seria que un miembro legitimo deja de ver los gastos de casa. Son dos o
 * tres usuarios: traerlos todos no cuesta nada.
 *
 * Sin cache deliberadamente: un registro nuevo o un cambio de la variable
 * tienen que verse en el request siguiente, no cuando expire un TTL.
 */
export async function getHouseholdUserIds(): Promise<string[]> {
  const policy = currentHouseholdPolicy();
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  return users.filter((u) => isHouseholdEmail(u.email, policy)).map((u) => u.id);
}

/** True si ese id de usuario es miembro del hogar. */
export async function isHouseholdMember(userId: string): Promise<boolean> {
  return (await getHouseholdUserIds()).includes(userId);
}
