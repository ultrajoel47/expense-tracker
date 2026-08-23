import { test } from "node:test";
import assert from "node:assert/strict";
import { formatConsultaAnswer } from "../src/lib/queries/format.ts";
import type { ConsultaAnswer } from "../src/lib/queries/aggregate.ts";
import type { ConsultaQuery } from "../src/lib/ai/types.ts";

function query(over: Partial<ConsultaQuery> = {}): ConsultaQuery {
  return {
    metric: "total",
    from: new Date(Date.UTC(2026, 7, 1, 12)),
    to: new Date(Date.UTC(2026, 7, 23, 12)),
    categoryName: null,
    scope: null,
    ...over,
  };
}

// ─── el periodo entendido siempre aparece ───────────────────────────────────

test("el encabezado dice el rango en dd/MM", () => {
  const answer: ConsultaAnswer = { kind: "total", total: 1000, cantidad: 1, materializacionFallida: false };
  const texto = formatConsultaAnswer(answer, query());
  assert.match(texto, /01\/08 al 23\/08/);
});

test("el encabezado nombra la categoria y el ambito cuando vinieron en la consulta", () => {
  const answer: ConsultaAnswer = { kind: "total", total: 1000, cantidad: 1, materializacionFallida: false };
  const texto = formatConsultaAnswer(answer, query({ categoryName: "Ropa", scope: "personal" }));
  assert.match(texto, /Ropa/);
  assert.match(texto, /personales/);
});

test("una categoria con caracteres de HTML sale escapada en el encabezado", () => {
  const answer: ConsultaAnswer = { kind: "total", total: 1000, cantidad: 1, materializacionFallida: false };
  const texto = formatConsultaAnswer(answer, query({ categoryName: "Casa & Jardín" }));
  assert.match(texto, /Casa &amp; Jardín/);
  assert.doesNotMatch(texto, /Casa & Jardín/);
});

// ─── total ──────────────────────────────────────────────────────────────

test("total con gastos muestra el monto y la cantidad, en 'movimientos' (no 'gastos')", () => {
  // Item 7: una compra en 3 cuotas dentro del rango son 3 CARGOS de un solo
  // gasto. "3 gastos" es una cuenta falsa; "movimientos" es correcto sin
  // importar si son gastos sueltos o cuotas de una sola compra.
  const answer: ConsultaAnswer = { kind: "total", total: 80000, cantidad: 3, materializacionFallida: false };
  const texto = formatConsultaAnswer(answer, query());
  assert.match(texto, /\$\s?80\.000/);
  assert.match(texto, /3 movimientos/);
  assert.doesNotMatch(texto, /gastos?\b/);
});

test("total con un solo gasto usa el singular", () => {
  const answer: ConsultaAnswer = { kind: "total", total: 5000, cantidad: 1, materializacionFallida: false };
  const texto = formatConsultaAnswer(answer, query());
  assert.match(texto, /1 movimiento\b/);
  assert.doesNotMatch(texto, /1 movimientos/);
});

test("total sin gastos dice que no hay, no un $0 sin contexto", () => {
  const answer: ConsultaAnswer = { kind: "total", total: 0, cantidad: 0, materializacionFallida: false };
  const texto = formatConsultaAnswer(answer, query());
  assert.match(texto, /no encontre gastos/);
  assert.doesNotMatch(texto, /\$/);
});

// ─── por_categoria ──────────────────────────────────────────────────────

test("por_categoria lista las categorias y un total al pie", () => {
  const answer: ConsultaAnswer = {
    kind: "por_categoria",
    filas: [
      { categoryName: "Supermercado", total: 50000 },
      { categoryName: "Ropa", total: 20000 },
    ],
    total: 70000,
    materializacionFallida: false,
  };
  const texto = formatConsultaAnswer(answer, query({ metric: "por_categoria" }));
  assert.match(texto, /Supermercado.*50\.000/);
  assert.match(texto, /Ropa.*20\.000/);
  assert.match(texto, /Total.*70\.000/);
});

test("por_categoria escapa un nombre de categoria con caracteres de HTML", () => {
  const answer: ConsultaAnswer = {
    kind: "por_categoria",
    filas: [{ categoryName: "Casa & Jardín", total: 1000 }],
    total: 1000,
    materializacionFallida: false,
  };
  const texto = formatConsultaAnswer(answer, query({ metric: "por_categoria" }));
  assert.match(texto, /Casa &amp; Jardín/);
});

test("por_categoria corta la cola en un 'y N mas' cuyo subtotal mas las lineas visibles cierra con el total", () => {
  const filas = Array.from({ length: 10 }, (_, i) => ({
    categoryName: `Cat${i}`,
    total: 100 - i, // descendente
  }));
  const total = filas.reduce((s, f) => s + f.total, 0);
  const answer: ConsultaAnswer = { kind: "por_categoria", filas, total, materializacionFallida: false };
  const texto = formatConsultaAnswer(answer, query({ metric: "por_categoria" }));

  assert.match(texto, /y 2 más/);
  // Las primeras 8 lineas visibles suman con la linea de "y N mas" el total
  // exacto que dice el pie.
  const sumaVisibles = filas.slice(0, 8).reduce((s, f) => s + f.total, 0);
  const sumaResto = filas.slice(8).reduce((s, f) => s + f.total, 0);
  assert.equal(sumaVisibles + sumaResto, total);
  assert.match(texto, new RegExp(`Total: \\$\\s?${total.toLocaleString("es-AR")}`));
});

test("por_categoria sin filas dice que no hay gastos", () => {
  const answer: ConsultaAnswer = { kind: "por_categoria", filas: [], total: 0, materializacionFallida: false };
  const texto = formatConsultaAnswer(answer, query({ metric: "por_categoria" }));
  assert.match(texto, /no encontre gastos/);
});

// ─── tendencia ──────────────────────────────────────────────────────────

test("tendencia lista un mes por linea con su nombre", () => {
  const answer: ConsultaAnswer = {
    kind: "tendencia",
    meses: [
      { periodo: "2026-07", total: 30000 },
      { periodo: "2026-08", total: 45000 },
    ],
    materializacionFallida: false,
  };
  const texto = formatConsultaAnswer(answer, query({ metric: "tendencia" }));
  assert.match(texto, /julio/i);
  assert.match(texto, /agosto/i);
  assert.match(texto, /30\.000/);
  assert.match(texto, /45\.000/);
});

test("tendencia con todos los meses en 0 dice que no hay gastos", () => {
  const answer: ConsultaAnswer = {
    kind: "tendencia",
    meses: [
      { periodo: "2026-07", total: 0 },
      { periodo: "2026-08", total: 0 },
    ],
    materializacionFallida: false,
  };
  const texto = formatConsultaAnswer(answer, query({ metric: "tendencia" }));
  assert.match(texto, /no encontre gastos/);
});

// ─── item 3: aviso de materializacion fallida ──────────────────────────────

test("materializacionFallida true agrega una linea de advertencia visible", () => {
  const answer: ConsultaAnswer = { kind: "total", total: 5000, cantidad: 1, materializacionFallida: true };
  const texto = formatConsultaAnswer(answer, query());
  assert.match(texto, /⚠/);
  assert.match(texto, /incompleto|CORTO/i);
});

test("materializacionFallida false no agrega ninguna advertencia", () => {
  const answer: ConsultaAnswer = { kind: "total", total: 5000, cantidad: 1, materializacionFallida: false };
  const texto = formatConsultaAnswer(answer, query());
  assert.doesNotMatch(texto, /⚠/);
});
