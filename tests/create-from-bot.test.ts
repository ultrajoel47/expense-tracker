import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfirmation, isAnomalous } from "../src/lib/expenses/create-from-bot.ts";

const BASE = {
  amount: 12000,
  description: "Panaderia",
  categoryName: "Comida y delivery",
  scope: "casa",
  payerName: "Joel",
  date: new Date("2026-08-22T12:00:00Z"),
  anomalous: false,
};

test("la confirmacion incluye monto, descripcion, categoria y scope", () => {
  const text = buildConfirmation(BASE);
  assert.match(text, /12\.000/);
  assert.match(text, /Panaderia/);
  assert.match(text, /Comida y delivery/);
  assert.match(text, /casa/i);
});

test("la confirmacion nombra al pagador", () => {
  assert.match(buildConfirmation(BASE), /Joel/);
});

test("un monto anomalo se marca con advertencia", () => {
  const text = buildConfirmation({ ...BASE, anomalous: true });
  assert.match(text, /revisa|verifica|⚠/i);
});

test("un monto normal no lleva advertencia", () => {
  assert.doesNotMatch(buildConfirmation(BASE), /⚠/);
});

test("isAnomalous: por encima del promedio de la categoria por el factor relativo", () => {
  assert.equal(isAnomalous(50000, 2000), true);
});

test("isAnomalous: dentro del promedio de la categoria no es anomalo", () => {
  assert.equal(isAnomalous(15000, 12000), false);
});

test("isAnomalous: sin historial (categoria vacia) pero por debajo del techo absoluto no es anomalo", () => {
  // Educacion no tiene gastos todavia: categoryAverage es null. Un monto
  // ordinario no debe dispararse solo por falta de historial.
  assert.equal(isAnomalous(35000, null), false);
});

test("isAnomalous: sin historial pero por encima del techo absoluto SI es anomalo", () => {
  // Este es el caso que el review encontro: el primer gasto de una categoria
  // vacia no tenia ningun techo. Un monto disparatado tiene que marcarse
  // aunque no haya promedio contra el cual compararlo.
  assert.equal(isAnomalous(5_000_000, null), true);
});

test("isAnomalous: el techo absoluto tambien aplica cuando SI hay historial", () => {
  // Un promedio bajo en la categoria (con el factor relativo ya harian
  // anomalo), pero se verifica que el techo absoluto por si solo alcance.
  assert.equal(isAnomalous(5_000_000, 1_000_000), true);
});
