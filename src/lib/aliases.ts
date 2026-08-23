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
 * El literal que `parseMessage` (`src/lib/ai/parse.ts`) usa como descripcion
 * de respaldo cuando la IA no devolvio ninguna. Replicado a mano, sin import,
 * porque `parse.ts` no lo exporta como constante — pero es EL MISMO valor a
 * proposito: si `parse.ts` cambia ese literal sin tocar este, `esPatronAprendible`
 * deja de reconocerlo y un gasto "sin descripcion" vuelve a poder aprenderse
 * como alias (ver el comentario de `PATRON_MINIMO`).
 */
const DESCRIPCION_DE_RESPALDO = "Sin descripcion";

/**
 * Un patron demasiado corto o generico no se aprende.
 *
 * `DESCRIPCION_DE_RESPALDO` es lo que `parseMessage` pone cuando la IA no
 * devolvio descripcion. Aprender un alias con ESE patron seria catastrofico
 * en silencio: quedaria una equivalencia "sin descripcion => tal categoria"
 * que despues se inyecta en el prompt y arrastra a esa categoria a todo gasto
 * sin descripcion.
 */
export const PATRON_MINIMO = 3;

export function esPatronAprendible(pattern: string): boolean {
  const normalizado = normalizePattern(pattern);
  if (normalizado.length < PATRON_MINIMO) return false;
  if (normalizado === normalizePattern(DESCRIPCION_DE_RESPALDO)) return false;
  return true;
}

export type AliasRow = {
  pattern: string;
  categoryId: string;
  description: string | null;
  scope: string | null;
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

/** El alias resuelto contra el nombre de su categoria, listo para el prompt. */
export type AliasForPrompt = {
  pattern: string;
  categoryName: string;
  description: string | null;
  scope: string | null;
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
      scope: row.scope,
    });
  }
  return resultado;
}

/**
 * Graba o actualiza el alias que una correccion enseña.
 *
 * Se aprende SOLO cuando la correccion cambio la categoria o el ambito: son las
 * dos cosas que un alias puede predecir. Corregir un monto o una fecha no
 * ensena nada sobre "que es" este gasto.
 *
 * `scope` se guarda solo si la correccion lo toco. El alias no lo FUERZA (el
 * prompt lo ofrece como contexto), y sobreescribirlo con el ambito incidental
 * de un gasto cuya correccion fue de categoria haria que un alias aprendido de
 * "esto es panaderia" tambien empiece a empujar un ambito que nadie enseno.
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
    scope: string;
    cambioLaCategoria: boolean;
    cambioElAmbito: boolean;
  },
  onError?: (error: unknown) => void
): Promise<boolean> {
  try {
    if (!entrada.cambioLaCategoria && !entrada.cambioElAmbito) return false;

    const pattern = normalizePattern(entrada.description);
    if (!esPatronAprendible(pattern)) return false;

    await client.alias.upsert({
      where: { pattern },
      create: {
        pattern,
        categoryId: entrada.categoryId,
        description: entrada.description,
        ...(entrada.cambioElAmbito ? { scope: entrada.scope } : {}),
      },
      update: {
        categoryId: entrada.categoryId,
        ...(entrada.cambioElAmbito ? { scope: entrada.scope } : {}),
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
