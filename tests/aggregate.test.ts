import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConsulta, type ConsultaClient } from "../src/lib/queries/aggregate.ts";
import type { ConsultaQuery } from "../src/lib/ai/types.ts";

const HOUSEHOLD = ["u1", "u2"];

const CATEGORIA = { id: "cat-1", name: "Alimentacion", color: "#16a34a" };

function gasto(over: Record<string, unknown> = {}) {
  return {
    id: "e1",
    amount: 10000,
    date: new Date(Date.UTC(2026, 7, 10, 12)),
    totalInstallments: null as number | null,
    category: CATEGORIA,
    installments: [] as { dueDate: Date; amount: number }[],
    ...over,
  };
}

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

function clienteFalso(
  opts: { expenses?: any[]; plantillas?: any[]; tirarMaterializacion?: boolean } = {}
) {
  const llamadas = { findMany: [] as any[], recurringFindMany: 0 };
  const client: ConsultaClient = {
    expense: {
      findMany: async (args: any) => {
        llamadas.findMany.push(args);
        return opts.expenses ?? [];
      },
    },
    recurringExpense: {
      findMany: async () => {
        llamadas.recurringFindMany++;
        if (opts.tirarMaterializacion) throw new Error("boom materializando");
        return opts.plantillas ?? [];
      },
    },
    $transaction: async (fn: any) =>
      fn({
        expense: {
          findFirst: async () => null,
          create: async () => ({}),
        },
      }),
  };
  return { client, llamadas };
}

// ─── visibilidad (el test mas importante de este archivo) ──────────────────

test("el where de la lectura contiene el predicado de visibilidad", async () => {
  const { client, llamadas } = clienteFalso();
  await resolveConsulta(client, query(), "u1", HOUSEHOLD);
  assert.equal(llamadas.findMany.length, 1);
  assert.deepEqual(llamadas.findMany[0].where, {
    OR: [
      { scope: "casa", userId: { in: HOUSEHOLD } },
      { scope: "personal", userId: "u1" },
    ],
  });
});

test("scope se suma al where cuando viene, y no cuando no viene", async () => {
  const { client: conScope, llamadas: llamadasConScope } = clienteFalso();
  await resolveConsulta(conScope, query({ scope: "personal" }), "u1", HOUSEHOLD);
  assert.equal(llamadasConScope.findMany[0].where.scope, "personal");

  const { client: sinScope, llamadas: llamadasSinScope } = clienteFalso();
  await resolveConsulta(sinScope, query(), "u1", HOUSEHOLD);
  assert.equal("scope" in llamadasSinScope.findMany[0].where, false);
});

test("categoryName se suma al where (por relacion) cuando viene, y no cuando no viene", async () => {
  const { client: conCategoria, llamadas: llamadasConCategoria } = clienteFalso();
  await resolveConsulta(conCategoria, query({ categoryName: "Ropa" }), "u1", HOUSEHOLD);
  assert.deepEqual(llamadasConCategoria.findMany[0].where.category, { name: "Ropa" });

  const { client: sinCategoria, llamadas: llamadasSinCategoria } = clienteFalso();
  await resolveConsulta(sinCategoria, query(), "u1", HOUSEHOLD);
  assert.equal("category" in llamadasSinCategoria.findMany[0].where, false);
});

// ─── total: la razon de ser de expensesToCharges ────────────────────────────

test("total cuenta el monto de un gasto simple", async () => {
  const { client } = clienteFalso({ expenses: [gasto()] });
  const r = await resolveConsulta(client, query(), "u1", HOUSEHOLD);
  assert.deepEqual(r, { kind: "total", total: 10000, cantidad: 1, materializacionFallida: false });
});

test("total de un gasto en cuotas cuenta la cuota que vence en el rango, no el total del gasto", async () => {
  const enCuotas = gasto({
    id: "e2",
    amount: 300000,
    date: new Date(Date.UTC(2026, 5, 10, 12)), // compra vieja, junio
    totalInstallments: 3,
    installments: [
      { dueDate: new Date(Date.UTC(2026, 6, 1, 12)), amount: 100000 },
      { dueDate: new Date(Date.UTC(2026, 7, 1, 12)), amount: 100000 }, // vence en agosto: dentro del rango
      { dueDate: new Date(Date.UTC(2026, 8, 1, 12)), amount: 100000 },
    ],
  });
  const { client } = clienteFalso({ expenses: [enCuotas] });
  const r = await resolveConsulta(client, query(), "u1", HOUSEHOLD); // rango: 01/08 al 23/08
  assert.deepEqual(r, { kind: "total", total: 100000, cantidad: 1, materializacionFallida: false });
});

test("un dia sin hora explicita en query.to cubre el dia entero (limite normalizado a medianoche)", async () => {
  // El gasto cae el mismo dia que `to`, a una hora cualquiera: no puede
  // quedar afuera solo porque `query.to` este a mediodia UTC.
  const g = gasto({ date: new Date(Date.UTC(2026, 7, 23, 23, 0, 0)) });
  const { client } = clienteFalso({ expenses: [g] });
  const r = await resolveConsulta(client, query(), "u1", HOUSEHOLD);
  assert.deepEqual(r, { kind: "total", total: 10000, cantidad: 1, materializacionFallida: false });
});

// ─── por_categoria ───────────────────────────────────────────────────────

test("por_categoria ordena por total descendente y el total general coincide con la suma de las filas", async () => {
  const catA = { id: "a", name: "A", color: "#1" };
  const catB = { id: "b", name: "B", color: "#2" };
  const expenses = [
    gasto({ id: "1", amount: 1000, category: catA }),
    gasto({ id: "2", amount: 5000, category: catB }),
    gasto({ id: "3", amount: 2000, category: catA }),
  ];
  const { client } = clienteFalso({ expenses });
  const r = await resolveConsulta(client, query({ metric: "por_categoria" }), "u1", HOUSEHOLD);
  assert.deepEqual(r, {
    kind: "por_categoria",
    filas: [
      { categoryName: "B", total: 5000 },
      { categoryName: "A", total: 3000 },
    ],
    total: 8000,
    materializacionFallida: false,
  });
});

// ─── tendencia ───────────────────────────────────────────────────────────

test("tendencia devuelve un mes por cada mes del rango, con 0 en los que no tienen gastos", async () => {
  const rango = query({
    metric: "tendencia",
    from: new Date(Date.UTC(2026, 5, 1, 12)), // junio
    to: new Date(Date.UTC(2026, 7, 23, 12)), // agosto
  });
  const expenses = [gasto({ date: new Date(Date.UTC(2026, 6, 15, 12)), amount: 4000 })]; // julio
  const { client } = clienteFalso({ expenses });
  const r = await resolveConsulta(client, rango, "u1", HOUSEHOLD);
  assert.deepEqual(r, {
    kind: "tendencia",
    meses: [
      { periodo: "2026-06", total: 0 },
      { periodo: "2026-07", total: 4000 },
      { periodo: "2026-08", total: 0 },
    ],
    materializacionFallida: false,
  });
});

// ─── item 4: la tendencia respeta el recorte de query.from/query.to ────────

test("un gasto con fecha posterior a 'to' dentro del mes en curso no entra en la tendencia", async () => {
  // rango: 01/08 al 23/08 (query() por defecto). El gasto es del 28/08, dentro
  // del mes de agosto pero DESPUES del recorte a `to`. Antes del arreglo,
  // "tendencia" usaba el mes CALENDARIO completo (01/08 al 01/09) y lo
  // contaba; ahora tiene que quedar afuera, igual que "total".
  const rango = query({ metric: "tendencia" });
  const gastoTardio = gasto({ date: new Date(Date.UTC(2026, 7, 28, 12)), amount: 7000 });
  const { client } = clienteFalso({ expenses: [gastoTardio] });
  const r = await resolveConsulta(client, rango, "u1", HOUSEHOLD);
  assert.deepEqual(r, {
    kind: "tendencia",
    meses: [{ periodo: "2026-08", total: 0 }],
    materializacionFallida: false,
  });
});

test("el total de la tendencia coincide con el de 'total' para el mismo rango", async () => {
  // Mismo rango, mismos gastos, dos metricas distintas: el recorte de cada mes
  // de la tendencia a [query.from, query.to] tiene que dejar la MISMA suma que
  // "total" calcula sobre el rango entero (charges.ts particiona el rango en
  // meses consecutivos sin overlap, asi que sumar los pedazos da lo mismo que
  // sumar el todo).
  const rango = query({
    from: new Date(Date.UTC(2026, 5, 15, 12)), // 15/06
    to: new Date(Date.UTC(2026, 7, 23, 12)), // 23/08
  });
  const expenses = [
    gasto({ id: "1", date: new Date(Date.UTC(2026, 5, 10, 12)), amount: 1000 }), // 10/06: ANTES del from, afuera
    gasto({ id: "2", date: new Date(Date.UTC(2026, 5, 20, 12)), amount: 2000 }), // 20/06: dentro
    gasto({ id: "3", date: new Date(Date.UTC(2026, 6, 15, 12)), amount: 3000 }), // 15/07: dentro
    gasto({ id: "4", date: new Date(Date.UTC(2026, 7, 20, 12)), amount: 4000 }), // 20/08: dentro
    gasto({ id: "5", date: new Date(Date.UTC(2026, 7, 28, 12)), amount: 5000 }), // 28/08: DESPUES del to, afuera
  ];

  const { client: clientTendencia } = clienteFalso({ expenses });
  const tendencia = await resolveConsulta(clientTendencia, { ...rango, metric: "tendencia" }, "u1", HOUSEHOLD);
  assert.equal(tendencia.kind, "tendencia");
  const totalTendencia =
    tendencia.kind === "tendencia" ? tendencia.meses.reduce((s, m) => s + m.total, 0) : NaN;

  const { client: clientTotal } = clienteFalso({ expenses });
  const total = await resolveConsulta(clientTotal, { ...rango, metric: "total" }, "u1", HOUSEHOLD);
  assert.equal(total.kind, "total");
  const totalTotal = total.kind === "total" ? total.total : NaN;

  assert.equal(totalTendencia, 9000); // 2000 + 3000 + 4000
  assert.equal(totalTendencia, totalTotal);
});

// ─── materializacion de recurrentes ──────────────────────────────────────

test("intenta materializar cada mes del rango, pero solo escribe en los que estan dentro de la ventana materializable", async () => {
  // Junio y julio de 2026 son anteriores a PRIMER_PERIODO_MATERIALIZABLE
  // ("2026-08"): esPeriodoMaterializable los descarta SIN tocar la base
  // (ver recurring-materialize.ts). Agosto de 2026 esta dentro de la ventana
  // (piso y techo de "hoy" coinciden en este momento), asi que es el UNICO
  // mes que llega a `recurringExpense.findMany`. Esto es determinístico para
  // siempre: los tres meses son fechas de calendario fijas, y el piso no se
  // mueve.
  const { client, llamadas } = clienteFalso();
  const rango = query({
    from: new Date(Date.UTC(2026, 5, 1, 12)),
    to: new Date(Date.UTC(2026, 7, 23, 12)),
  });
  await resolveConsulta(client, rango, "u1", HOUSEHOLD);
  assert.equal(llamadas.recurringFindMany, 1);
});

test("un fallo de materializacion no aborta la respuesta pero queda marcado en materializacionFallida", async () => {
  // Rango de un solo mes (agosto) para que la materializacion se intente de
  // verdad (esPeriodoMaterializable la deja pasar) y tire.
  const { client } = clienteFalso({ expenses: [gasto()], tirarMaterializacion: true });
  const r = await resolveConsulta(client, query(), "u1", HOUSEHOLD);
  assert.equal(r.materializacionFallida, true);
  // La lectura se sirve igual, con lo que ya estuviera materializado.
  assert.deepEqual(r, { kind: "total", total: 10000, cantidad: 1, materializacionFallida: true });
});

test("un fallo de materializacion se reporta por onError, sin propagar", async () => {
  const { client } = clienteFalso({ tirarMaterializacion: true });
  let capturado: unknown;
  await resolveConsulta(client, query(), "u1", HOUSEHOLD, (error) => {
    capturado = error;
  });
  assert.ok(capturado instanceof Error);
});

test("sin fallo de materializacion, materializacionFallida es false", async () => {
  const { client } = clienteFalso();
  const r = await resolveConsulta(client, query(), "u1", HOUSEHOLD);
  assert.equal(r.materializacionFallida, false);
});
