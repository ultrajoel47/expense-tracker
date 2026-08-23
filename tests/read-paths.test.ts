import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Este test reemplaza un grep manual del plan de la Rebanada 1:
 *
 *   grep -rn 'userId: session.id' src/app/api/expenses/  # sin resultados en lecturas
 *
 * El grep se corrio UNA vez, a mano, y por eso no protegio nada despues: una
 * revision posterior encontro cinco archivos que habian derivado exactamente
 * en la forma que el grep existia para atrapar. Convertido en test, la deriva
 * rompe `npm test`.
 *
 * La regla que se protege: **ninguna LECTURA de Expense o RecurringExpense
 * filtra por `userId: session.id` a mano.** La lectura se resuelve siempre con
 * `visibleExpensesWhere` / `visibleRecurringExpensesWhere` de
 * `src/lib/visibility.ts`, que son las unicas que saben la regla completa
 * (casa acotado a los miembros del hogar + personales solo de quien pago).
 * Filtrar por `userId: session.id` en una lectura es un bug en las dos
 * direcciones: esconde los gastos de casa que pago el otro, y —si mas
 * adelante se combina con un OR— puede abrir los personales del otro.
 *
 * Las ESCRITURAS si lo usan legitimamente: en la web quien carga es quien
 * pago, asi que `userId: session.id` es el pagador. La primera version de
 * este test era granular POR ARCHIVO: forbidia `userId: session.id` en
 * cualquier lugar de un archivo, con una allowlist que perdonaba el archivo
 * entero. Eso dejaba ciega a la version anterior justo donde mas importaba:
 * un `prisma.expense.findMany({ where: { userId: session.id } })` agregado
 * DENTRO de `expenses/route.ts` (que ya estaba en la allowlist por su
 * escritura legitima en el POST) pasaba desapercibido — confirmado agregando
 * esa linea a mano y viendo que `npm test` seguia en verde.
 *
 * Ahora el matcheo es POR LLAMADA: se mira el cuerpo de cada llamada de
 * lectura de Prisma sobre Expense/RecurringExpense (`LECTURA_RE`) y se busca
 * el patron prohibido SOLO ahi adentro (`PROHIBIDO_RE`). Como las escrituras
 * (`create`, `update`, `upsert`, `delete`, `updateMany`, `deleteMany`) no
 * estan en `LECTURAS`, un `userId: session.id` legitimo en un `create()` ya
 * no necesita entrar a ninguna allowlist: la tightening lo excluye por
 * construccion, no por permiso. Por eso `BARE_USER_ID_ALLOWLIST` de abajo
 * queda vacia hoy — no hay, en este repo, ninguna LECTURA de Expense o
 * RecurringExpense que filtre legitimamente por `userId: session.id` a
 * secas (CreditCard es la unica excepcion real del dominio, y no es
 * `expense` ni `recurringExpense`: `LECTURA_RE` ni la mira). Se deja la
 * estructura (con su guard de obsolescencia) para que agregar una excepcion
 * futura siga siendo un acto deliberado, con motivo, y no algo que se
 * cuele por escribir un route handler nuevo.
 */

const SRC_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

/** Directorios barridos. `src/lib` se sumo porque un modulo ahi que lea
 * gastos era invisible para la version anterior del test, que solo miraba
 * `src/app/api`. */
const SCAN_DIRS = ["app/api", "lib"];

/**
 * Archivos donde `userId: session.id` es correcto DENTRO de una llamada de
 * lectura de Expense/RecurringExpense.
 *
 * Al agregar una entrada acá, escribir POR QUE es una excepcion legitima del
 * dominio (no "asi anda"). Hoy esta vacia: ver el comentario de cabecera.
 */
const BARE_USER_ID_ALLOWLIST: Record<string, string> = {};

/**
 * Archivos que leen Expense o RecurringExpense SIN pasar por la regla de
 * visibilidad, deliberadamente — YA NO "solo agregados": desde el arreglo de
 * I3, dos de las entradas de abajo son `findFirst` que devuelven filas
 * completas (la de mayor riesgo del sistema, en `handleCallback`, incluida).
 * Lo que las hace seguras no es el shape de la lectura sino que la exencion es
 * POR LLAMADA (`llamadas` abajo) y cada motivo explica por que esa llamada
 * puntual no necesita, o no puede, pasar por `visibleExpensesWhere`.
 *
 * `motivo` es prosa; `llamadas` son fragmentos de texto (substrings del
 * cuerpo del argumento de la llamada, capturado por `LECTURA_RE`) que
 * identifican CADA lectura exenta de ese archivo. El test de abajo
 * ("las exenciones de NO_VISIBILITY_ALLOWLIST son por llamada, no por
 * archivo") verifica las dos direcciones: toda lectura que `LECTURA_RE`
 * encuentre en el archivo tiene que matchear alguno de sus fragmentos (o usar
 * la regla de visibilidad), y todo fragmento declarado tiene que matchear
 * alguna lectura real — si no, es una entrada obsoleta.
 */
const NO_VISIBILITY_ALLOWLIST: Record<string, { motivo: string; llamadas: string[] }> = {
  "app/api/categories/[id]/route.ts": {
    motivo:
      "`count` para el guard del DELETE: no se puede borrar una categoria con " +
      "gastos apuntando a ella, INCLUIDOS los que quien borra no puede ver. " +
      "Acotarlo por visibilidad seria el bug.",
    llamadas: ["where: { categoryId: id }"],
  },
  "app/api/telegram/webhook/route.ts": {
    motivo:
      "Tres llamadas exentas. (1) El `aggregate` del promedio de la categoria " +
      "para la señal de monto anomalo: el promedio es del hogar, no el de " +
      "quien escribe. (2) El `findFirst` de `handleCallback`: la puerta de la " +
      "edicion por bot es `canEditViaBot`, y es MAS ESTRICTA que la " +
      "visibilidad — exige haber pagado o cargado el gasto, no solo poder " +
      "verlo. Filtrar tambien por visibilidad ahi cancela la Regla de Dominio " +
      "5 en el caso que la motiva (ver C1 del review del Bloque 2). (3) El " +
      "`findFirst` con `select: { creditCard }` de `buildCorrectedConfirmation`: " +
      "lee solo el nombre de la tarjeta de un gasto que el actor ya esta " +
      "autorizado a editar (paso por `canEditViaBot` en `handleCallback` antes " +
      "de llegar aca).",
    llamadas: [
      "_avg: { amount: true }",
      "where: { id: action.expenseId }",
      "select: { creditCard: { select: { name: true } } }",
    ],
  },
  "lib/expenses/correct.ts": {
    motivo:
      "Las dos lecturas de `resolveCorrectionTarget` son correctas por " +
      "CONSTRUCCION, no por chequeo. La de reply esta acotada por " +
      "`botChatId + botMessageId` del propio chat del actor (el reply solo " +
      "puede apuntar a un mensaje que el bot le mando a ESE chat); la del " +
      "respaldo esta acotada por `createdById: actorId`. En los dos casos " +
      "`canEditViaBot` pasa necesariamente (exige haber pagado O cargado, y " +
      "createdById === actorId ya alcanza). Si alguien ensancha uno de esos " +
      "dos `where` — por ejemplo para buscar por otro chat o por otro actor — " +
      "la garantia se cae y hay que revisar el permiso de nuevo.",
    llamadas: [
      "botChatId: chatId, botMessageId: replyToMessageId",
      "createdById: actorId, source: { not: \"recurring\" }",
    ],
  },
  "lib/recurring-materialize.ts": {
    motivo:
      "`client.recurringExpense.findMany({ where: { active, frequency } })` " +
      "trae TODAS las plantillas activas del hogar para materializarlas, sin " +
      "importar quien disparo el GET que dispara la materializacion. No hay " +
      "actor cuya visibilidad aplicar: es un job que corre para las dos " +
      "personas a la vez. Filtrar por visibilidad del actor dejaria sin " +
      "materializar (silenciosamente) las plantillas de la otra persona.",
    llamadas: ["active: true, frequency: { in: [...FRECUENCIAS_MATERIALIZABLES] }"],
  },
};

/** Lecturas que devuelven filas o agregados de Expense / RecurringExpense
 * (matcheo por ARCHIVO, usado por la regla de visibilidad y por el guard de
 * obsolescencia de NO_VISIBILITY_ALLOWLIST). Prefijo `(?:prisma|client)\.`:
 * los modulos puros (`src/lib/expenses/correct.ts`,
 * `src/lib/recurring-materialize.ts`) reciben el cliente de Prisma por
 * parametro y lo llaman `client`, no `prisma` — anclar solo en `prisma` deja
 * afuera justo a los modulos que se testean sin base, que es el caso que mas
 * le importa a este archivo (ver I3 del review del Bloque 2). Sigue sin ver
 * un alias como `tx` (el cliente de una transaccion, ver
 * `recurring-materialize.ts`): es la misma limitacion 4 de mas abajo, aplicada
 * al nombre del cliente en vez de al de la sesion. */
const READ_CALL = /(?:prisma|client)\.(expense|recurringExpense)\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy)/;

// ─── Matcheo por LLAMADA (tightening de esta tarea) ─────────────────────────

const MODELOS = String.raw`(?:expense|recurringExpense)`;
// Incluye las variantes *OrThrow ademas de las del brief: son lecturas de
// Prisma tan validas como las otras y el repo no las usa hoy, pero si alguien
// las suma manana el detector tiene que verlas igual.
const LECTURAS = String.raw`(?:findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy)`;

/**
 * Matchea una llamada de lectura de Prisma y captura el cuerpo de su argumento,
 * de forma no-greedy para no engancharse con la llamada siguiente. Es un
 * heuristico de texto, no un parser: alcanza porque el patron que buscamos esta
 * escrito de forma uniforme en todo el repo, y el test de obsolescencia que el
 * archivo ya tiene avisa si eso deja de ser cierto.
 *
 * Prefijo `(?:prisma|client)\.`, no solo `prisma\.`: los modulos puros reciben
 * el cliente de Prisma por PARAMETRO (para poder testearse sin base) y lo
 * llaman `client`, nunca `prisma` — anclar solo en el literal `prisma` deja
 * esos modulos completamente invisibles para este escaner, que es como
 * `lib/expenses/correct.ts` quedo afuera hasta el review del Bloque 2 pese a
 * tener dos lecturas de Expense sin visibilidad.
 */
const LECTURA_RE = new RegExp(
  String.raw`(?:prisma|client)\.` + MODELOS + String.raw`\.` + LECTURAS + String.raw`\s*\(([\s\S]*?)\)\s*;`,
  "g"
);

const PROHIBIDO_RE = /userId:\s*session\.id/;

/**
 * LIMITACIONES CONOCIDAS de este heuristico (documentadas aca, no solo en el
 * reporte de la tarea, porque el reporte se borra al cerrar la slice y una
 * limitacion que solo vive ahi es una limitacion olvidada):
 *
 * 1. GAP DE MODELO ANIDADO: `LECTURA_RE` ancla en `prisma.expense.` /
 *    `prisma.recurringExpense.` de forma literal. Un filtro anidado del tipo
 *    `prisma.installment.findMany({ where: { expense: { userId: session.id } } })`
 *    es invisible para este test porque la llamada de nivel superior es sobre
 *    OTRO modelo. Ese shape exacto ya existe, hoy de forma legitima, en
 *    `src/app/api/credit-cards/[id]/pending/route.ts` (las tarjetas son por
 *    persona, no por scope). El mismo shape sobre un modelo futuro quedaria
 *    permanentemente sin ver. No se resuelve extendiendo el regex: seria
 *    empezar a construir un parser de relaciones anidadas, que es exactamente
 *    el tipo de complejidad que este heuristico decide no asumir.
 *
 * 2. FALSO POSITIVO POR FUSION EN `Promise.all`: `LECTURA_RE` captura de forma
 *    no-greedy hasta el proximo `);`. Cuando una llamada termina en `,` en vez
 *    de `;` (tipico de `Promise.all([a, b])`), la captura sigue de largo y
 *    fusiona esa llamada con la siguiente en un solo bloque. Si mas adelante
 *    se agrega, DENTRO de ese mismo `Promise.all`, una lectura de OTRO modelo
 *    que legitimamente filtra por `userId: session.id` a secas (ej.
 *    `CreditCard`, que no tiene `scope`), el test de arriba la marcaria como
 *    infractora aunque sea correcta. Hoy no pasa: `src/app/api/telegram/webhook/route.ts`
 *    tiene ese mismo shape de `Promise.all` pero con `payer.id`, no
 *    `session.id`. Un cambio futuro tipo dashboard que junte tarjetas y
 *    gastos en el mismo `Promise.all` podria dispararlo. Tampoco se resuelve
 *    en el regex: requeriria rastrear identificadores de variable
 *    (indireccion), que es el otro tipo de complejidad que este heuristico
 *    decide no asumir.
 *
 * 3. LECTURA SIN NINGUN `where`: `LECTURA_RE` solo mira DENTRO del argumento
 *    de una llamada que ya matcheo; no exige que ese argumento tenga un
 *    `where` en absoluto. Un `prisma.expense.findMany({ orderBy, take })` sin
 *    `where` pasa las DOS pruebas de arriba (no hay `userId: session.id` que
 *    prohibir, y "toda lectura pasa por la regla de visibilidad" solo revisa
 *    que el ARCHIVO mencione `visibleExpensesWhere` en algun lado, no que esa
 *    llamada puntual la use). Un archivo que ya usa la regla en otras
 *    llamadas queda con la guardia baja: un `findMany` nuevo sin `where`
 *    devuelve TODOS los gastos de TODOS los usuarios, de las dos casas y de
 *    los dos scopes. Es mas facil de escribir por accidente que un filtro a
 *    mano (alcanza con olvidarse el `where`), asi que el gap es mas ancho de
 *    lo que sugiere el nombre "PROHIBIDO_RE": no hay nada prohibido, hay algo
 *    ausente, y este heuristico solo sabe buscar texto presente.
 *
 * 4. OTRO NOMBRE PARA LA SESION: `PROHIBIDO_RE` matchea el string literal
 *    `userId: session.id`. Cualquier alias rompe el match: `const s = await
 *    getSession()` seguido de `{ userId: s.id }`, o una desestructuracion
 *    (`const { id } = await getSession()` seguido de `{ userId: id }`), pasan
 *    de largo aunque sean exactamente el mismo bug que el test existe para
 *    atrapar. No se resuelve en el regex sin rastrear de donde sale cada
 *    identificador — el mismo tipo de indireccion que la limitacion 2 ya
 *    nombra, aca aplicado al nombre de la variable en vez de al limite de la
 *    llamada.
 */

/** Cuerpos de argumento de cada llamada de lectura de Expense/RecurringExpense
 * encontrada en `src`. `matchAll` clona `LECTURA_RE` internamente (exige el
 * flag `g` para eso), asi que reusar la misma instancia entre archivos es
 * seguro: no arrastra `lastIndex` de un archivo al siguiente. */
function lecturaArgs(src: string): string[] {
  return [...src.matchAll(LECTURA_RE)].map((m) => m[1]);
}

/** True si alguna llamada de lectura de Expense/RecurringExpense en `src`
 * filtra por `userId: session.id` dentro de su propio argumento. */
function hasProhibitedRead(src: string): boolean {
  return lecturaArgs(src).some((args) => PROHIBIDO_RE.test(args));
}

function walk(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, rel));
    } else if (entry.endsWith(".ts")) {
      out.push(rel);
    }
  }
  return out;
}

/** Rutas relativas a `src/`, ej. `app/api/expenses/route.ts`, `lib/household.ts`. */
const FILES = SCAN_DIRS.flatMap((d) => walk(path.join(SRC_ROOT, d), d));

function read(rel: string): string {
  return readFileSync(path.join(SRC_ROOT, rel), "utf8");
}

test("hay archivos para revisar (el test no se puede volver vacio)", () => {
  assert.ok(FILES.length >= 30, `solo se encontraron ${FILES.length} archivos bajo ${SCAN_DIRS.join(", ")}`);
});

test("ninguna llamada de lectura de Expense/RecurringExpense filtra por 'userId: session.id'", () => {
  const infractores = FILES.filter(
    (rel) => !(rel in BARE_USER_ID_ALLOWLIST) && hasProhibitedRead(read(rel))
  );

  assert.deepEqual(
    infractores,
    [],
    "Estos archivos tienen una LECTURA (findMany/findFirst/findUnique/count/aggregate/" +
      "groupBy) de Expense o RecurringExpense que filtra por 'userId: session.id'. Usar " +
      "visibleExpensesWhere(session.id, householdUserIds) / visibleRecurringExpensesWhere(...) " +
      "en su lugar. Si es una excepcion legitima del dominio, agregarla a " +
      `BARE_USER_ID_ALLOWLIST con el motivo: ${infractores.join(", ")}`
  );
});

test("toda lectura de Expense/RecurringExpense pasa por la regla de visibilidad", () => {
  const infractores = FILES.filter((rel) => {
    if (rel in NO_VISIBILITY_ALLOWLIST) return false;
    const src = read(rel);
    if (!READ_CALL.test(src)) return false;
    return !src.includes("visibleExpensesWhere") && !src.includes("visibleRecurringExpensesWhere");
  });

  assert.deepEqual(
    infractores,
    [],
    "Estos archivos leen Expense o RecurringExpense sin usar la regla de visibilidad: " +
      infractores.join(", ")
  );
});

test("las exenciones de NO_VISIBILITY_ALLOWLIST son por llamada, no por archivo", () => {
  // Este es el test que I3 vino a agregar. Antes, un archivo en el allowlist
  // quedaba exento POR COMPLETO: una lectura nueva ahi adentro, con el where
  // que fuera, no rompia nada. Aca cada lectura que `LECTURA_RE` capture en un
  // archivo del allowlist tiene que dar cuenta de si misma: o usa la regla de
  // visibilidad, o matchea alguno de los fragmentos declarados en `llamadas`
  // (que documentan, con motivo, por que esa lectura puntual es segura sin
  // visibilidad). Una lectura NUEVA en `handleCallback` o en cualquier otro
  // lado de un archivo exento no matchea ningun fragmento existente y este
  // test se pone rojo hasta que alguien la declare a mano.
  //
  // Y en la otra direccion: un fragmento declarado que no matchea NINGUNA
  // lectura real es una entrada obsoleta (la llamada que describia se borro o
  // cambio de forma) y hay que sacarlo, no dejarlo de adorno.
  for (const [rel, { llamadas }] of Object.entries(NO_VISIBILITY_ALLOWLIST)) {
    const args = lecturaArgs(read(rel));

    const sinFragmento = args.filter(
      (arg) =>
        !arg.includes("visibleExpensesWhere") &&
        !arg.includes("visibleRecurringExpensesWhere") &&
        !llamadas.some((fragmento) => arg.includes(fragmento))
    );
    assert.deepEqual(
      sinFragmento,
      [],
      `${rel} tiene una lectura de Expense/RecurringExpense que no matchea ningun ` +
        `fragmento de NO_VISIBILITY_ALLOWLIST ni usa la regla de visibilidad. Cuerpo(s): ` +
        sinFragmento.join(" ||| ")
    );

    const obsoletos = llamadas.filter((fragmento) => !args.some((arg) => arg.includes(fragmento)));
    assert.deepEqual(
      obsoletos,
      [],
      `${rel} tiene fragmentos en NO_VISIBILITY_ALLOWLIST que ya no matchean ninguna ` +
        `lectura real (entrada obsoleta, hay que borrarla): ${obsoletos.join(", ")}`
    );
  }
});

test("la regla de visibilidad se llama siempre con los ids del hogar", () => {
  // Un `visibleExpensesWhere(session.id)` de un argumento vuelve a la rama de
  // casa sin acotar, que es el agujero original. TypeScript ya lo rechaza; el
  // test lo deja explicito y sobrevive a un `any`.
  const sinHogar: string[] = [];
  for (const rel of FILES) {
    const src = read(rel);
    for (const m of src.matchAll(/visible(?:Recurring)?ExpensesWhere\(([^)]*)\)/g)) {
      if (!m[1].includes(",")) sinHogar.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(sinHogar, [], `llamadas sin los ids del hogar: ${sinHogar.join(", ")}`);
});

test("las entradas de las allowlists no quedaron obsoletas", () => {
  // Una allowlist que sobrevive al archivo o a la llamada que la justificaba
  // es deuda invisible: el proximo archivo con ese nombre hereda una
  // excepcion que nadie decidio.
  for (const [rel, motivo] of Object.entries(BARE_USER_ID_ALLOWLIST)) {
    assert.ok(FILES.includes(rel), `BARE_USER_ID_ALLOWLIST tiene un archivo que ya no existe: ${rel}`);
    assert.ok(
      hasProhibitedRead(read(rel)),
      `${rel} ya no tiene una lectura con 'userId: session.id': sacarlo de BARE_USER_ID_ALLOWLIST (${motivo})`
    );
  }
  for (const [rel, { motivo }] of Object.entries(NO_VISIBILITY_ALLOWLIST)) {
    assert.ok(FILES.includes(rel), `NO_VISIBILITY_ALLOWLIST tiene un archivo que ya no existe: ${rel}`);
    assert.ok(
      READ_CALL.test(read(rel)),
      `${rel} ya no lee Expense/RecurringExpense: sacarlo de NO_VISIBILITY_ALLOWLIST (${motivo})`
    );
  }
});
