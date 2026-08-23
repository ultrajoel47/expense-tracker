import { test } from "node:test";
import assert from "node:assert/strict";
import {
  visibleExpensesWhere,
  visibleRecurringExpensesWhere,
  canEditViaBot,
  householdPolicy,
  isHouseholdEmail,
} from "../src/lib/visibility.ts";

const JOEL = "joel-id";
const ELLA = "ella-id";
const EXTRANO = "extrano-id";
const HOGAR = [JOEL, ELLA];

// ─── Regla de lectura ───────────────────────────────────────────────────────

test("visibleExpensesWhere incluye los gastos de casa, acotados a los miembros", () => {
  const where = visibleExpensesWhere(JOEL, HOGAR);
  assert.deepEqual(where.OR[0], { scope: "casa", userId: { in: HOGAR } });
});

test("visibleExpensesWhere limita los personales a quien pago", () => {
  const where = visibleExpensesWhere(JOEL, HOGAR);
  assert.deepEqual(where.OR[1], { scope: "personal", userId: JOEL });
});

test("visibleExpensesWhere no expone personales por createdById", () => {
  const where = visibleExpensesWhere(JOEL, HOGAR);
  const serialized = JSON.stringify(where);
  assert.ok(!serialized.includes("createdById"));
});

test("visibleExpensesWhere NUNCA deja la rama de casa sin predicado de identidad", () => {
  // Esta es LA regresion que abrio el agujero: `{ scope: "casa" }` a secas.
  for (const [principal, hogar] of [
    [JOEL, HOGAR],
    [EXTRANO, HOGAR],
    [JOEL, [JOEL]],
    [JOEL, []],
  ] as const) {
    const where = visibleExpensesWhere(principal, hogar);
    for (const clause of where.OR) {
      assert.notDeepEqual(clause, { scope: "casa" });
      assert.ok(
        "userId" in clause,
        `una rama de la visibilidad quedo sin userId: ${JSON.stringify(clause)}`
      );
    }
  }
});

test("visibleExpensesWhere no le da rama de casa a un principal fuera del hogar", () => {
  const where = visibleExpensesWhere(EXTRANO, HOGAR);
  assert.equal(where.OR.length, 1);
  assert.deepEqual(where.OR[0], { scope: "personal", userId: EXTRANO });
});

test("visibleExpensesWhere no le da rama de casa a nadie si el hogar esta vacio", () => {
  // Es el caso de HOUSEHOLD_EMAILS sin definir en produccion: se falla cerrado.
  const where = visibleExpensesWhere(JOEL, []);
  assert.equal(where.OR.length, 1);
  assert.deepEqual(where.OR[0], { scope: "personal", userId: JOEL });
});

test("visibleExpensesWhere siempre devuelve la forma { OR: [...] }", () => {
  // Varias rutas construyen el resto del filtro asumiendo que `OR` es de la
  // visibilidad y que lo suyo va en `AND`. Si esta forma cambia, el filtro de
  // mes o de scope pisaria la regla de privacidad.
  for (const [principal, hogar] of [
    [JOEL, HOGAR],
    [EXTRANO, HOGAR],
    [JOEL, []],
  ] as const) {
    const where = visibleExpensesWhere(principal, hogar);
    assert.deepEqual(Object.keys(where), ["OR"]);
    assert.ok(Array.isArray(where.OR) && where.OR.length > 0);
  }
});

// ─── La propiedad de privacidad, evaluada contra filas sinteticas ────────────

type Row = { scope: string; userId: string };

/** Evalua el `where` que produce la visibilidad contra una fila en memoria. */
function matches(where: { OR: Record<string, unknown>[] }, row: Row): boolean {
  return where.OR.some((clause) =>
    Object.entries(clause).every(([field, expected]) => {
      const actual = row[field as keyof Row];
      if (expected !== null && typeof expected === "object" && "in" in expected) {
        return (expected.in as string[]).includes(actual);
      }
      return actual === expected;
    })
  );
}

const FILAS: Row[] = [
  { scope: "casa", userId: JOEL },
  { scope: "casa", userId: ELLA },
  { scope: "casa", userId: EXTRANO },
  { scope: "personal", userId: JOEL },
  { scope: "personal", userId: ELLA },
  { scope: "personal", userId: EXTRANO },
];

test("propiedad: un extraño no ve NINGUNA fila del hogar", () => {
  const where = visibleExpensesWhere(EXTRANO, HOGAR);
  const visibles = FILAS.filter((f) => matches(where, f));
  assert.deepEqual(visibles, [{ scope: "personal", userId: EXTRANO }]);
});

test("propiedad: un miembro ve las de casa de los miembros y solo sus personales", () => {
  const where = visibleExpensesWhere(JOEL, HOGAR);
  const visibles = FILAS.filter((f) => matches(where, f));
  assert.deepEqual(visibles, [
    { scope: "casa", userId: JOEL },
    { scope: "casa", userId: ELLA },
    { scope: "personal", userId: JOEL },
  ]);
});

test("propiedad: un miembro NO ve una fila de casa pagada por un extraño", () => {
  const where = visibleExpensesWhere(JOEL, HOGAR);
  assert.equal(matches(where, { scope: "casa", userId: EXTRANO }), false);
});

test("propiedad: ningun principal ve el personal de otro, sea miembro o no", () => {
  for (const principal of [JOEL, ELLA, EXTRANO]) {
    const where = visibleExpensesWhere(principal, HOGAR);
    for (const otro of [JOEL, ELLA, EXTRANO].filter((o) => o !== principal)) {
      assert.equal(
        matches(where, { scope: "personal", userId: otro }),
        false,
        `${principal} vio el personal de ${otro}`
      );
    }
  }
});

test("propiedad: con el hogar vacio nadie ve nada de casa", () => {
  for (const principal of [JOEL, ELLA, EXTRANO]) {
    const where = visibleExpensesWhere(principal, []);
    for (const fila of FILAS.filter((f) => f.scope === "casa")) {
      assert.equal(matches(where, fila), false);
    }
  }
});

// ─── Permiso de edicion via bot ─────────────────────────────────────────────

test("canEditViaBot permite al pagador", () => {
  const expense = { userId: JOEL, createdById: ELLA };
  assert.equal(canEditViaBot(expense, JOEL), true);
});

test("canEditViaBot permite a quien lo registro aunque no lo pueda leer", () => {
  const expense = { userId: JOEL, createdById: ELLA };
  assert.equal(canEditViaBot(expense, ELLA), true);
});

test("canEditViaBot rechaza a un tercero", () => {
  const expense = { userId: JOEL, createdById: JOEL };
  assert.equal(canEditViaBot(expense, "otro-id"), false);
});

// ─── Recurrentes ────────────────────────────────────────────────────────────

test("visibleRecurringExpensesWhere acota los de casa a los miembros", () => {
  const where = visibleRecurringExpensesWhere(JOEL, HOGAR);
  assert.deepEqual(where.OR[0], { scope: "casa", userId: { in: HOGAR } });
});

test("visibleRecurringExpensesWhere limita los personales a quien paga", () => {
  const where = visibleRecurringExpensesWhere(JOEL, HOGAR);
  assert.deepEqual(where.OR[1], { scope: "personal", userId: JOEL });
});

test("visibleRecurringExpensesWhere aplica la misma regla que visibleExpensesWhere", () => {
  assert.deepEqual(visibleRecurringExpensesWhere(JOEL, HOGAR), visibleExpensesWhere(JOEL, HOGAR));
  assert.deepEqual(
    visibleRecurringExpensesWhere(EXTRANO, HOGAR),
    visibleExpensesWhere(EXTRANO, HOGAR)
  );
});

// ─── Politica de membresia (la otra mitad del modelo de privacidad) ─────────

test("householdPolicy parsea la allowlist normalizando espacios y mayusculas", () => {
  const policy = householdPolicy("  Uno@Casa.com , dos@casa.com ", "production");
  assert.deepEqual(policy, { emails: ["uno@casa.com", "dos@casa.com"], allowAny: false });
});

test("householdPolicy ignora entradas vacias y comas sueltas", () => {
  const policy = householdPolicy("uno@casa.com,,  ,dos@casa.com,", "production");
  assert.deepEqual(policy.emails, ["uno@casa.com", "dos@casa.com"]);
});

test("householdPolicy sin variable en produccion FALLA CERRADO", () => {
  for (const raw of [undefined, null, "", "   ", " , "]) {
    const policy = householdPolicy(raw, "production");
    assert.deepEqual(
      policy,
      { emails: [], allowAny: false },
      `HOUSEHOLD_EMAILS=${JSON.stringify(raw)} tendria que fallar cerrado en produccion`
    );
    assert.equal(isHouseholdEmail("cualquiera@internet.com", policy), false);
  }
});

test("householdPolicy sin variable fuera de produccion abre para no romper el dev local", () => {
  for (const env of ["development", "test", undefined, null]) {
    const policy = householdPolicy(undefined, env);
    assert.equal(policy.allowAny, true, `NODE_ENV=${env} tendria que abrir`);
    assert.equal(isHouseholdEmail("cualquiera@internet.com", policy), true);
  }
});

test("householdPolicy con variable definida NUNCA abre, ni en desarrollo", () => {
  const policy = householdPolicy("uno@casa.com", "development");
  assert.equal(policy.allowAny, false);
  assert.equal(isHouseholdEmail("otro@internet.com", policy), false);
});

test("isHouseholdEmail compara sin distinguir mayusculas ni espacios", () => {
  const policy = householdPolicy("uno@casa.com", "production");
  assert.equal(isHouseholdEmail("  UNO@Casa.COM ", policy), true);
  assert.equal(isHouseholdEmail("uno@casa.com.ar", policy), false);
  assert.equal(isHouseholdEmail("no@casa.com", policy), false);
});
