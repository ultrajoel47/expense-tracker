import { test } from "node:test";
import assert from "node:assert/strict";
import { expensesToCharges } from "../src/lib/expenses/charges.ts";

const CAT = { id: "cat-1", name: "Alimentacion", color: "#16a34a" };
const MARZO = { from: new Date(Date.UTC(2026, 2, 1)), to: new Date(Date.UTC(2026, 3, 1)) };

function gasto(over = {}) {
  return {
    id: "e1",
    amount: 1000,
    date: new Date(Date.UTC(2026, 2, 10, 12)),
    totalInstallments: null as number | null,
    category: CAT,
    installments: [] as { dueDate: Date; amount: number }[],
    ...over,
  };
}

test("un gasto sin cuotas produce un cargo por su monto", () => {
  const c = expensesToCharges([gasto()], MARZO.from, MARZO.to);
  assert.equal(c.length, 1);
  assert.equal(c[0].amount, 1000);
  assert.equal(c[0].categoryName, "Alimentacion");
});

test("un gasto sin cuotas fuera del rango no produce cargo", () => {
  const c = expensesToCharges([gasto({ date: new Date(Date.UTC(2026, 1, 10, 12)) })], MARZO.from, MARZO.to);
  assert.equal(c.length, 0);
});

test("un gasto en cuotas produce el monto de la CUOTA, no el total", () => {
  const e = gasto({
    amount: 300000,
    date: new Date(Date.UTC(2025, 6, 10, 12)),
    totalInstallments: 6,
    installments: [
      { dueDate: new Date(Date.UTC(2026, 2, 1, 12)), amount: 50000 },
      { dueDate: new Date(Date.UTC(2026, 3, 1, 12)), amount: 50000 },
    ],
  });
  const c = expensesToCharges([e], MARZO.from, MARZO.to);
  assert.equal(c.length, 1);
  assert.equal(c[0].amount, 50000, "tiene que ser la cuota, no los 300000");
});

test("la fecha del cargo de una cuota es su vencimiento, no la compra", () => {
  const e = gasto({
    date: new Date(Date.UTC(2025, 6, 10, 12)),
    totalInstallments: 2,
    installments: [{ dueDate: new Date(Date.UTC(2026, 2, 1, 12)), amount: 500 }],
  });
  const c = expensesToCharges([e], MARZO.from, MARZO.to);
  assert.equal(c[0].date.toISOString().slice(0, 7), "2026-03");
});

test("un gasto en cuotas sin filas de cuota no produce nada, y no explota", () => {
  const e = gasto({ totalInstallments: 6, installments: [] });
  assert.deepEqual(expensesToCharges([e], MARZO.from, MARZO.to), []);
});

test("varias cuotas del mismo gasto en el rango producen varios cargos", () => {
  const e = gasto({
    totalInstallments: 12,
    installments: [
      { dueDate: new Date(Date.UTC(2026, 2, 1, 12)), amount: 100 },
      { dueDate: new Date(Date.UTC(2026, 2, 15, 12)), amount: 100 },
      { dueDate: new Date(Date.UTC(2026, 3, 1, 12)), amount: 100 },
    ],
  });
  const c = expensesToCharges([e], MARZO.from, MARZO.to);
  assert.equal(c.length, 2);
});

test("totalInstallments 1 se trata como sin cuotas", () => {
  const c = expensesToCharges([gasto({ totalInstallments: 1 })], MARZO.from, MARZO.to);
  assert.equal(c.length, 1);
  assert.equal(c[0].amount, 1000);
});

test("el limite superior es exclusivo y el inferior inclusivo", () => {
  const justoAntes = gasto({ id: "a", date: new Date(Date.UTC(2026, 1, 28, 23, 59)) });
  const primerDia = gasto({ id: "b", date: MARZO.from });
  const primerDiaDelSiguiente = gasto({ id: "c", date: MARZO.to });
  const c = expensesToCharges([justoAntes, primerDia, primerDiaDelSiguiente], MARZO.from, MARZO.to);
  assert.deepEqual(c.map((x) => x.expenseId), ["b"]);
});
