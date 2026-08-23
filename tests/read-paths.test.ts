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
 * pago, asi que `userId: session.id` es el pagador. Por eso las excepciones se
 * enumeran de a una, con motivo, en las allowlists de abajo: **agregar una
 * entrada tiene que ser un acto deliberado**, no algo que pase de casualidad
 * por escribir un route handler nuevo.
 */

const API_ROOT = fileURLToPath(new URL("../src/app/api/", import.meta.url));

/**
 * Archivos donde `userId: session.id` es correcto.
 *
 * Al agregar una entrada acá, escribir POR QUE es una escritura o por que el
 * modelo no tiene `scope`. Si el motivo es "asi anda", es un bug.
 */
const BARE_USER_ID_ALLOWLIST: Record<string, string> = {
  // ESCRITURA: POST /api/expenses crea el gasto. Desde la web quien carga es
  // quien pago, asi que userId (el pagador) es la sesion. La lectura del GET
  // del mismo archivo usa visibleExpensesWhere.
  "expenses/route.ts": "escritura: userId es el pagador del gasto que se crea",

  // ESCRITURA: POST /api/recurring-expenses crea la plantilla a nombre de
  // quien la carga.
  "recurring-expenses/route.ts": "escritura: userId es quien paga el recurrente",

  // CreditCard NO tiene campo `scope`: las tarjetas son POR PERSONA por
  // diseño, no hay tarjeta "de casa". `userId: session.id` es el filtro de
  // pertenencia correcto para ese modelo, en lectura y en escritura.
  "credit-cards/route.ts": "CreditCard es por persona: no tiene scope",
  "credit-cards/[id]/route.ts": "CreditCard es por persona: no tiene scope",
  // Este ademas filtra Installment por `expense: { creditCardId, userId }`:
  // las cuotas pendientes de MI tarjeta son las de los gastos que YO pague con
  // ella. Es el mismo criterio por persona de la tarjeta, no la regla de scope.
  "credit-cards/[id]/pending/route.ts":
    "CreditCard es por persona; las cuotas se acotan a los gastos del dueño de la tarjeta",
};

/**
 * Archivos que leen Expense o RecurringExpense SIN pasar por la regla de
 * visibilidad, deliberadamente. Solo agregados (no devuelven filas) y solo
 * cuando el agregado tiene que ser del hogar entero.
 */
const NO_VISIBILITY_ALLOWLIST: Record<string, string> = {
  // `prisma.expense.count({ where: { categoryId } })` para el guard del DELETE:
  // no se puede borrar una categoria con gastos apuntando a ella, INCLUIDOS los
  // que quien borra no puede ver. Acotarlo por visibilidad seria el bug.
  "categories/[id]/route.ts": "count para el guard del DELETE: tiene que ver todos los gastos",
  // `prisma.expense.aggregate` con el promedio de la categoria, para la señal
  // de monto anomalo. Es el promedio del hogar, no el de quien escribe.
  "telegram/webhook/route.ts": "promedio de la categoria para la señal de anomalia",
};

/** Lecturas que devuelven filas o agregados de Expense / RecurringExpense. */
const READ_CALL = /prisma\.(expense|recurringExpense)\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy)/;

const BARE_USER_ID = /userId:\s*session\.id/;

function routeFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      out.push(...routeFiles(full, rel));
    } else if (entry.endsWith(".ts")) {
      out.push(rel);
    }
  }
  return out;
}

const FILES = routeFiles(API_ROOT);

test("hay rutas de API para revisar (el test no se puede volver vacio)", () => {
  assert.ok(FILES.length >= 15, `solo se encontraron ${FILES.length} rutas en ${API_ROOT}`);
});

test("ninguna lectura de Expense/RecurringExpense filtra por 'userId: session.id'", () => {
  const infractores = FILES.filter(
    (rel) =>
      BARE_USER_ID.test(readFileSync(path.join(API_ROOT, rel), "utf8")) &&
      !(rel in BARE_USER_ID_ALLOWLIST)
  );

  assert.deepEqual(
    infractores,
    [],
    "Estos archivos usan 'userId: session.id' y no estan en la allowlist. Si es una " +
      "LECTURA de gastos, usar visibleExpensesWhere(session.id, householdUserIds). Si es " +
      "una escritura (o un modelo sin scope), agregarlo a BARE_USER_ID_ALLOWLIST con el " +
      `motivo: ${infractores.join(", ")}`
  );
});

test("toda lectura de Expense/RecurringExpense pasa por la regla de visibilidad", () => {
  const infractores = FILES.filter((rel) => {
    if (rel in NO_VISIBILITY_ALLOWLIST) return false;
    const src = readFileSync(path.join(API_ROOT, rel), "utf8");
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
    const src = readFileSync(path.join(API_ROOT, rel), "utf8");
    for (const m of src.matchAll(/visible(?:Recurring)?ExpensesWhere\(([^)]*)\)/g)) {
      if (!m[1].includes(",")) sinHogar.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(sinHogar, [], `llamadas sin los ids del hogar: ${sinHogar.join(", ")}`);
});

test("las entradas de las allowlists no quedaron obsoletas", () => {
  // Una allowlist que sobrevive al archivo que justificaba es deuda invisible:
  // el proximo archivo con ese nombre hereda una excepcion que nadie decidio.
  for (const [rel, motivo] of Object.entries(BARE_USER_ID_ALLOWLIST)) {
    assert.ok(FILES.includes(rel), `BARE_USER_ID_ALLOWLIST tiene un archivo que ya no existe: ${rel}`);
    assert.ok(
      BARE_USER_ID.test(readFileSync(path.join(API_ROOT, rel), "utf8")),
      `${rel} ya no usa 'userId: session.id': sacarlo de BARE_USER_ID_ALLOWLIST (${motivo})`
    );
  }
  for (const [rel, motivo] of Object.entries(NO_VISIBILITY_ALLOWLIST)) {
    assert.ok(FILES.includes(rel), `NO_VISIBILITY_ALLOWLIST tiene un archivo que ya no existe: ${rel}`);
    assert.ok(
      READ_CALL.test(readFileSync(path.join(API_ROOT, rel), "utf8")),
      `${rel} ya no lee Expense/RecurringExpense: sacarlo de NO_VISIBILITY_ALLOWLIST (${motivo})`
    );
  }
});
