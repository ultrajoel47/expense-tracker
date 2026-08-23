import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstallments } from "../src/lib/expenses/installments.ts";

test("genera una fila por cuota, numeradas desde 1", () => {
  const rows = buildInstallments(new Date("2026-03-15T12:00:00Z"), 300, 3);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.installmentNumber), [1, 2, 3]);
});

test("las cuotas caen en meses consecutivos", () => {
  const rows = buildInstallments(new Date("2026-03-15T12:00:00Z"), 300, 3);
  assert.deepEqual(
    rows.map((r) => r.dueDate.toISOString().slice(0, 7)),
    ["2026-03", "2026-04", "2026-05"]
  );
});

test("no saltea meses cuando la compra cae el 31", () => {
  // El 31 de enero + 1 mes con setMonth da "31 de febrero", que JS normaliza
  // a marzo: febrero quedaria sin cuota y marzo con dos.
  const rows = buildInstallments(new Date("2026-01-31T12:00:00Z"), 300, 3);
  assert.deepEqual(
    rows.map((r) => r.dueDate.toISOString().slice(0, 7)),
    ["2026-01", "2026-02", "2026-03"]
  );
});

test("las cuotas suman exactamente el total", () => {
  const rows = buildInstallments(new Date("2026-03-15T12:00:00Z"), 100, 3);
  const suma = rows.reduce((s, r) => s + r.amount, 0);
  assert.equal(Math.round(suma * 100) / 100, 100);
});

test("el resto va en la ultima cuota, no se pierde", () => {
  const rows = buildInstallments(new Date("2026-03-15T12:00:00Z"), 100, 3);
  assert.equal(rows[0].amount, 33.33);
  assert.equal(rows[1].amount, 33.33);
  assert.equal(rows[2].amount, 33.34);
});

test("un total divisible reparte parejo", () => {
  const rows = buildInstallments(new Date("2026-03-15T12:00:00Z"), 300, 3);
  assert.deepEqual(rows.map((r) => r.amount), [100, 100, 100]);
});

test("count menor o igual a 1 devuelve vacio", () => {
  assert.deepEqual(buildInstallments(new Date("2026-03-15T12:00:00Z"), 300, 1), []);
  assert.deepEqual(buildInstallments(new Date("2026-03-15T12:00:00Z"), 300, 0), []);
});
