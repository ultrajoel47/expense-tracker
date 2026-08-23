import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfirmation, isAnomalous, resolveCard } from "../src/lib/expenses/create-from-bot.ts";

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

test("corregido: true usa el glifo de lapiz en vez del check", () => {
  const text = buildConfirmation({ ...BASE, corregido: true });
  assert.match(text, /^✏/);
  assert.doesNotMatch(text, /^✓/);
});

test("sin el campo corregido, sigue usando el check (comportamiento existente)", () => {
  const text = buildConfirmation(BASE);
  assert.match(text, /^✓/);
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

// ─── Resolucion de la tarjeta por nombre ────────────────────────────────────

const CARDS = [
  { id: "c1", name: "Brubank" },
  { id: "c2", name: "BBVA Crédito" },
  { id: "c3", name: "Mercado pago débito " },
  { id: "c4", name: "Visa Galicia" },
];

test("resolveCard matchea el nombre exacto", () => {
  assert.equal(resolveCard("Brubank", CARDS)?.id, "c1");
});

test("resolveCard ignora mayusculas, acentos y espacios de sobra", () => {
  assert.equal(resolveCard("  bbva credito ", CARDS)?.id, "c2");
  assert.equal(resolveCard("MERCADO PAGO DEBITO", CARDS)?.id, "c3");
});

test("resolveCard matchea parcial: 'visa' cae en la Visa Galicia", () => {
  // El caso del review: la persona dice "con la visa", no el nombre de la fila.
  assert.equal(resolveCard("visa", CARDS)?.id, "c4");
});

test("resolveCard matchea al reves: lo que dijo contiene el nombre de la tarjeta", () => {
  assert.equal(resolveCard("mercado pago debito naranja", CARDS)?.id, "c3");
});

test("resolveCard prefiere el match exacto al parcial", () => {
  const cards = [{ id: "parcial", name: "Visa Galicia" }, { id: "exacto", name: "Visa" }];
  assert.equal(resolveCard("visa", cards)?.id, "exacto");
});

test("resolveCard devuelve null si no matchea ninguna", () => {
  assert.equal(resolveCard("amex", CARDS), null);
});

test("resolveCard devuelve null sin nombre de tarjeta o sin tarjetas", () => {
  assert.equal(resolveCard(null, CARDS), null);
  assert.equal(resolveCard(undefined, CARDS), null);
  assert.equal(resolveCard("   ", CARDS), null);
  assert.equal(resolveCard("visa", []), null);
});

// ─── La tarjeta en la confirmacion ─────────────────────────────────────────

test("la confirmacion nombra la tarjeta cuando el gasto quedo con una", () => {
  const text = buildConfirmation({ ...BASE, cardName: "Visa Galicia" });
  assert.match(text, /Visa Galicia/);
  assert.doesNotMatch(text, /No encontre una tarjeta/);
});

test("la confirmacion AVISA cuando la tarjeta que dijo no matcheo ninguna", () => {
  const text = buildConfirmation({ ...BASE, cardName: null, unmatchedCardName: "visa" });
  assert.match(text, /No encontre una tarjeta/);
  assert.match(text, /"visa"/);
  assert.match(text, /SIN tarjeta/);
});

test("un gasto sin tarjeta no menciona tarjetas", () => {
  const text = buildConfirmation(BASE);
  assert.doesNotMatch(text, /tarjeta/i);
});
