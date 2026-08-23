import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePeriodParams } from "../src/lib/period-params.ts";

const HOY = new Date(2026, 7, 23); // 23 de agosto de 2026, hora local

test("mes y año validos pasan tal cual y quedan marcados como explicitos", () => {
  const r = parsePeriodParams("3", "2026", HOY);
  assert.deepEqual(r, { ok: true, year: 2026, month: 3, explicito: true });
});

test("sin parametros cae al mes actual, sin marcar explicito", () => {
  const r = parsePeriodParams(null, null, HOY);
  assert.deepEqual(r, { ok: true, year: 2026, month: 8, explicito: false });
});

test("un parametro vacio se trata como ausente (comportamiento previo)", () => {
  const r = parsePeriodParams("", "", HOY);
  assert.deepEqual(r, { ok: true, year: 2026, month: 8, explicito: false });
});

test("solo uno de los dos: se completa el otro pero NO es explicito", () => {
  assert.deepEqual(parsePeriodParams("5", null, HOY), {
    ok: true,
    year: 2026,
    month: 5,
    explicito: false,
  });
});

test("mes 13 se rechaza: era la clave fantasma '2026-13' con fila en 2027-01", () => {
  const r = parsePeriodParams("13", "2026", HOY);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /mes/i);
});

test("mes 0 y mes negativo se rechazan", () => {
  assert.equal(parsePeriodParams("0", "2026", HOY).ok, false);
  assert.equal(parsePeriodParams("-1", "2026", HOY).ok, false);
});

test("mes no numerico se rechaza: era el 500 por 'NaN-NaN' e Invalid Date", () => {
  for (const malo of ["abc", "3.5", "0x3", "1e1", "+3"]) {
    assert.equal(parsePeriodParams(malo, "2026", HOY).ok, false, `mes ${malo}`);
  }
});

test("un parametro con solo espacios cuenta como ausente, no como invalido", () => {
  // Decision deliberada: " " es equivalente a "" (que ya caia al mes actual
  // antes de este cambio), no un valor mal escrito.
  assert.deepEqual(parsePeriodParams(" ", " ", HOY), {
    ok: true,
    year: 2026,
    month: 8,
    explicito: false,
  });
});

test("año fuera de rango o no numerico se rechaza", () => {
  for (const malo of ["1999", "2101", "999", "10000", "abc", "-2026"]) {
    const r = parsePeriodParams("8", malo, HOY);
    assert.equal(r.ok, false, `año ${malo}`);
    assert.match((r as { error: string }).error, /año/i);
  }
});

test("los limites del rango de años se aceptan", () => {
  assert.equal(parsePeriodParams("1", "2000", HOY).ok, true);
  assert.equal(parsePeriodParams("12", "2100", HOY).ok, true);
});

test("se toleran espacios alrededor del numero", () => {
  assert.deepEqual(parsePeriodParams(" 3 ", " 2026 ", HOY), {
    ok: true,
    year: 2026,
    month: 3,
    explicito: true,
  });
});
