import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleExpensesWhere, canEditViaBot } from "../src/lib/visibility.ts";

const JOEL = "joel-id";
const ELLA = "ella-id";

test("visibleExpensesWhere incluye siempre los gastos de casa", () => {
  const where = visibleExpensesWhere(JOEL);
  assert.deepEqual(where.OR[0], { scope: "casa" });
});

test("visibleExpensesWhere limita los personales a quien pago", () => {
  const where = visibleExpensesWhere(JOEL);
  assert.deepEqual(where.OR[1], { scope: "personal", userId: JOEL });
});

test("visibleExpensesWhere no expone personales por createdById", () => {
  const where = visibleExpensesWhere(JOEL);
  const serialized = JSON.stringify(where);
  assert.ok(!serialized.includes("createdById"));
});

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
