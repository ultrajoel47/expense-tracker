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
 * visibilidad, deliberadamente. Solo agregados (no devuelven filas) y solo
 * cuando el agregado tiene que ser del hogar entero.
 */
const NO_VISIBILITY_ALLOWLIST: Record<string, string> = {
  // `prisma.expense.count({ where: { categoryId } })` para el guard del DELETE:
  // no se puede borrar una categoria con gastos apuntando a ella, INCLUIDOS los
  // que quien borra no puede ver. Acotarlo por visibilidad seria el bug.
  "app/api/categories/[id]/route.ts": "count para el guard del DELETE: tiene que ver todos los gastos",
  // `prisma.expense.aggregate` con el promedio de la categoria, para la señal
  // de monto anomalo. Es el promedio del hogar, no el de quien escribe.
  "app/api/telegram/webhook/route.ts": "promedio de la categoria para la señal de anomalia",
};

/** Lecturas que devuelven filas o agregados de Expense / RecurringExpense
 * (matcheo por ARCHIVO, usado por la regla de visibilidad y por el guard de
 * obsolescencia de NO_VISIBILITY_ALLOWLIST). */
const READ_CALL = /prisma\.(expense|recurringExpense)\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy)/;

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
 */
const LECTURA_RE = new RegExp(
  String.raw`prisma\.` + MODELOS + String.raw`\.` + LECTURAS + String.raw`\s*\(([\s\S]*?)\)\s*;`,
  "g"
);

const PROHIBIDO_RE = /userId:\s*session\.id/;

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
  for (const [rel, motivo] of Object.entries(NO_VISIBILITY_ALLOWLIST)) {
    assert.ok(FILES.includes(rel), `NO_VISIBILITY_ALLOWLIST tiene un archivo que ya no existe: ${rel}`);
    assert.ok(
      READ_CALL.test(read(rel)),
      `${rel} ya no lee Expense/RecurringExpense: sacarlo de NO_VISIBILITY_ALLOWLIST (${motivo})`
    );
  }
});
