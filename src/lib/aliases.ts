import { FALLBACK_DESCRIPTION } from "./ai/parse.ts";
import type { AliasForPrompt } from "./ai/types.ts";

/**
 * Normaliza un patron de alias: minusculas, sin acentos, sin espacios de
 * sobra. Es lo que hace que "Panaderia", "panadería" y "  PANADERÍA  "
 * resuelvan al mismo alias.
 *
 * Es la MISMA transformacion que `normalizeCardName` en
 * `src/lib/expenses/create-from-bot.ts`, y esta duplicada a proposito: la de
 * tarjetas compara un nombre que dijo la persona contra filas existentes y
 * puede cambiar sin consecuencias; esta define la CLAVE UNICA con la que se
 * guarda un alias, asi que cambiarla invalida los aliases ya aprendidos. Que
 * compartan implementacion volveria un cambio inocuo en una migracion de datos.
 */
export function normalizePattern(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Un patron demasiado corto o generico no se aprende.
 *
 * `FALLBACK_DESCRIPTION` (`src/lib/ai/parse.ts`) es lo que `parseMessage`
 * pone cuando la IA no devolvio descripcion. Aprender un alias con ESE patron
 * seria catastrofico en silencio: quedaria una equivalencia "sin descripcion
 * => tal categoria" que despues se inyecta en el prompt y arrastra a esa
 * categoria a todo gasto sin descripcion. Se IMPORTA en vez de replicarse a
 * mano: una copia aparte podia divergir de `parse.ts` sin que nada lo
 * marcara, y esta funcion dejaria de reconocer el literal real.
 */
export const PATRON_MINIMO = 3;

export function esPatronAprendible(pattern: string): boolean {
  const normalizado = normalizePattern(pattern);
  if (normalizado.length < PATRON_MINIMO) return false;
  if (normalizado === normalizePattern(FALLBACK_DESCRIPTION)) return false;
  return true;
}

export type AliasRow = {
  pattern: string;
  categoryId: string;
  description: string | null;
  hits: number;
};

/** El minimo de Prisma que este modulo usa, para no importar `@prisma/client`. */
export type AliasClient = {
  alias: {
    findMany(args: unknown): Promise<AliasRow[]>;
    upsert(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

/**
 * Los aliases que se inyectan en el prompt, con el nombre de su categoria.
 *
 * **Acotado a `TOPE_PARA_EL_PROMPT`.** Los aliases se aprenden solos con cada
 * correccion, asi que la tabla crece sin techo mientras el prompt tiene uno:
 * sin el limite, el contexto se llena de equivalencias viejas de una sola vez y
 * empuja afuera a las instrucciones. Se ordena por `hits` descendente para que
 * lo que sobreviva sea lo que de verdad se usa, y por `createdAt` descendente
 * como desempate, para que un alias recien aprendido (hits 0) entre antes que
 * uno viejo que nunca acerto.
 */
export const TOPE_PARA_EL_PROMPT = 40;

export async function loadAliasesForPrompt(
  client: AliasClient,
  categories: readonly { id: string; name: string }[]
): Promise<AliasForPrompt[]> {
  const rows = await client.alias.findMany({
    orderBy: [{ hits: "desc" }, { createdAt: "desc" }],
    take: TOPE_PARA_EL_PROMPT,
  });

  const resultado: AliasForPrompt[] = [];
  for (const row of rows) {
    // Una categoria borrada dejaria un alias apuntando a la nada: el prompt
    // nombraria una categoria que no esta en la lista de opciones, que es
    // justo lo que el prompt le prohibe a la IA. Se descarta en vez de
    // arrastrar un nombre inventado.
    const categoria = categories.find((c) => c.id === row.categoryId);
    if (!categoria) continue;
    resultado.push({
      pattern: row.pattern,
      categoryName: categoria.name,
      description: row.description,
    });
  }
  return resultado;
}

/**
 * Graba o actualiza el alias que una correccion de CATEGORIA ensena.
 *
 * Dos restricciones, las dos por privacidad, las dos deliberadas:
 *
 * 1. **Solo se aprende de gastos de casa.** Los aliases se inyectan en el prompt
 *    de los DOS miembros del hogar y ese prompt se manda a un proveedor de IA
 *    externo en cada mensaje. Un alias aprendido de un gasto `personal` llevaria
 *    la descripcion de ese gasto —un tratamiento medico, un regalo sorpresa— al
 *    contexto de la otra persona y a un tercero, indefinidamente. No es una
 *    lectura de `Expense`, asi que ningun guard lo detecta: la unica defensa es
 *    esta guarda.
 *
 * 2. **Un alias ensena la categoria y nada mas.** Antes tambien podia ensenar el
 *    ambito, y eso peleaba con la regla de ambito del prompt por el lado
 *    peligroso: `Alias` no tiene `userId`, asi que una correccion de UNA persona
 *    marcando "farmacia" como personal hacia que las farmacias que cargara la
 *    OTRA salieran personales tambien — invisibles para quien no las pago, y
 *    faltando en su total de casa. La columna `scope` sigue en el schema (la base
 *    tiene datos y no hay razon para migrar) pero no se escribe ni se lee.
 *
 * Nunca tira: un alias es una optimizacion, y hacer fallar una correccion que
 * YA se aplico en la base porque no se pudo guardar una equivalencia seria
 * cambiar un dato correcto por un mensaje de error. Los errores se reportan por
 * el callback `onError` (el modulo es puro y no conoce `console`).
 */
export async function learnAlias(
  client: AliasClient,
  entrada: {
    description: string;
    categoryId: string;
    /** El ambito RESULTANTE del gasto, para la restriccion 1 de arriba. */
    scope: string;
    cambioLaCategoria: boolean;
  },
  onError?: (error: unknown) => void
): Promise<boolean> {
  try {
    if (!entrada.cambioLaCategoria) return false;
    if (entrada.scope === "personal") return false;

    const pattern = normalizePattern(entrada.description);
    if (!esPatronAprendible(pattern)) return false;

    await client.alias.upsert({
      where: { pattern },
      create: {
        pattern,
        categoryId: entrada.categoryId,
        description: entrada.description,
      },
      update: {
        categoryId: entrada.categoryId,
      },
    });
    return true;
  } catch (error) {
    onError?.(error);
    return false;
  }
}

/**
 * Suma un acierto al alias que predijo bien este gasto.
 *
 * Como el prompt inyecta los aliases pero la IA decide sola si los usa, no hay
 * forma directa de saber si uno influyo. La senal que se usa es la observable:
 * el gasto quedo con la descripcion de un alias Y con la categoria que ese
 * alias predice. Es una heuristica y `hits` no es un numero exacto — es lo que
 * ordena que aliases sobreviven al tope del prompt, no un dato del dominio.
 *
 * Nunca tira, por el mismo motivo que `learnAlias`: esto es telemetria y corre
 * DESPUES de que el gasto ya existe.
 */
export async function recordAliasHit(
  client: AliasClient,
  description: string,
  categoryId: string,
  onError?: (error: unknown) => void
): Promise<void> {
  try {
    await client.alias.updateMany({
      where: { pattern: normalizePattern(description), categoryId },
      data: { hits: { increment: 1 } },
    });
  } catch (error) {
    onError?.(error);
  }
}
