import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAmount, resolveDate, todayInBuenosAires } from "../src/lib/ai/normalize.ts";

test("normalizeAmount pasa numeros limpios", () => {
  assert.equal(normalizeAmount(12000), 12000);
  assert.equal(normalizeAmount("12000"), 12000);
});

test("normalizeAmount entiende lucas y palos", () => {
  assert.equal(normalizeAmount("12 lucas"), 12000);
  assert.equal(normalizeAmount("2 palos"), 2000000);
  assert.equal(normalizeAmount("1 luca"), 1000);
});

test("normalizeAmount trata el punto de miles como miles", () => {
  assert.equal(normalizeAmount("12.500"), 12500);
  assert.equal(normalizeAmount("1.250.300"), 1250300);
});

test("normalizeAmount trata la coma como decimal", () => {
  assert.equal(normalizeAmount("12500,50"), 12500.5);
});

test("normalizeAmount rechaza basura y no negativos", () => {
  assert.equal(normalizeAmount("panaderia"), null);
  assert.equal(normalizeAmount(""), null);
  assert.equal(normalizeAmount(-100), null);
  assert.equal(normalizeAmount(0), null);
});

test("resolveDate acepta una fecha de hoy", () => {
  const today = new Date("2026-08-22T12:00:00Z");
  const result = resolveDate("2026-08-22", today);
  assert.ok(result instanceof Date);
  assert.equal(result?.toISOString().slice(0, 10), "2026-08-22");
});

test("resolveDate rechaza fechas futuras", () => {
  const today = new Date("2026-08-22T12:00:00Z");
  assert.equal(resolveDate("2026-08-23", today), null);
});

test("resolveDate rechaza fechas de mas de 6 meses atras", () => {
  const today = new Date("2026-08-22T12:00:00Z");
  assert.equal(resolveDate("2025-12-01", today), null);
});

test("resolveDate rechaza basura", () => {
  const today = new Date("2026-08-22T12:00:00Z");
  assert.equal(resolveDate("ayer", today), null);
  assert.equal(resolveDate("", today), null);
});

test("todayInBuenosAires usa la zona de Argentina y no UTC", () => {
  // 02:30 UTC del 22 son las 23:30 del 21 en Buenos Aires (UTC-3)
  assert.equal(todayInBuenosAires(new Date("2026-08-22T02:30:00Z")), "2026-08-21");
});

test("normalizeAmount rechaza compound slang que podria ser interpretado de multiples formas", () => {
  assert.equal(normalizeAmount("3 lucas con 500"), null);
  assert.equal(normalizeAmount("12 lucas el 15"), null);
  assert.equal(normalizeAmount("2 palos y 300"), null);
});

test("normalizeAmount sigue pasando los cuatro casos validos con separadores", () => {
  assert.equal(normalizeAmount("12.500"), 12500);
  assert.equal(normalizeAmount("1.250.300"), 1250300);
  assert.equal(normalizeAmount("12500,50"), 12500.5);
  assert.equal(normalizeAmount("12 lucas"), 12000);
});
