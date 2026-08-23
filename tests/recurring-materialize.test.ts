import { test } from "node:test";
import assert from "node:assert/strict";
import { materializeRecurringForMonth, periodKey } from "../src/lib/recurring-materialize.ts";

function clienteFalso(plantillas: any[], yaExistentes: string[] = []) {
  const creados: any[] = [];
  const existentes = new Set(yaExistentes);
  const tx = {
    expense: {
      findFirst: async ({ where }: any) =>
        existentes.has(where.recurringExpenseId + ":" + where.recurringPeriod) ? { id: "ya" } : null,
      create: async ({ data }: any) => {
        existentes.add(data.recurringExpenseId + ":" + data.recurringPeriod);
        creados.push(data);
        return { id: "nuevo" };
      },
    },
  };
  return {
    creados,
    client: {
      recurringExpense: { findMany: async () => plantillas },
      $transaction: async (fn: any) => fn(tx),
    },
  };
}

const ALQUILER = {
  id: "rec-1",
  userId: "u1",
  categoryId: "cat-1",
  creditCardId: null,
  amount: 500000,
  description: "Alquiler",
  frequency: "MONTHLY",
  scope: "casa",
  active: true,
  createdAt: new Date(Date.UTC(2025, 0, 1)),
};

test("periodKey es el año-mes con dos digitos", () => {
  assert.equal(periodKey(2026, 3), "2026-03");
  assert.equal(periodKey(2026, 12), "2026-12");
});

test("crea un Expense por plantilla activa", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  const n = await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(n, 1);
  assert.equal(creados[0].amount, 500000);
  assert.equal(creados[0].description, "Alquiler");
  assert.equal(creados[0].scope, "casa");
  assert.equal(creados[0].source, "recurring");
  assert.equal(creados[0].recurringPeriod, "2026-03");
});

test("el pagador y el creador son el userId de la plantilla", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(creados[0].userId, "u1");
  assert.equal(creados[0].createdById, "u1");
});

test("es idempotente: no duplica si ya existe el periodo", async () => {
  const { client, creados } = clienteFalso([ALQUILER], ["rec-1:2026-03"]);
  const n = await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(n, 0);
  assert.equal(creados.length, 0);
});

test("dos corridas seguidas crean una sola vez", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  await materializeRecurringForMonth(client as any, 2026, 3);
  await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(creados.length, 1);
});

test("no materializa un mes anterior a la creacion de la plantilla", async () => {
  const nueva = { ...ALQUILER, createdAt: new Date(Date.UTC(2026, 5, 1)) };
  const { client, creados } = clienteFalso([nueva]);
  const n = await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(n, 0, "no puede inventar un alquiler de antes de que existiera la plantilla");
  assert.equal(creados.length, 0);
});

test("la fecha del gasto es el dia 1 del periodo, a mediodia UTC", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(creados[0].date.toISOString(), "2026-03-01T12:00:00.000Z");
});

test("una violacion P2002 concurrente (dos lecturas a la vez) se cuenta como 'ya existe', no revienta ni aborta el resto del lote", async () => {
  const EXPENSAS = { ...ALQUILER, id: "rec-2", description: "Expensas" };
  const creados: any[] = [];
  let llamada = 0;
  const client = {
    recurringExpense: { findMany: async () => [ALQUILER, EXPENSAS] },
    $transaction: async (fn: any) => {
      llamada++;
      // La primera plantilla pierde la carrera: otra lectura concurrente
      // ya la creo y el indice unico parcial tira P2002.
      if (llamada === 1) {
        throw { code: "P2002" };
      }
      const tx = {
        expense: {
          findFirst: async () => null,
          create: async ({ data }: any) => {
            creados.push(data);
            return { id: "nuevo" };
          },
        },
      };
      return fn(tx);
    },
  };

  const n = await materializeRecurringForMonth(client as any, 2026, 3);

  assert.equal(n, 1, "la plantilla que choco no cuenta como creada por esta llamada");
  assert.equal(creados.length, 1, "la siguiente plantilla del lote se sigue procesando");
  assert.equal(creados[0].description, "Expensas");
});

test("un error que no es P2002 se relanza, no se confunde con 'ya existe'", async () => {
  const client = {
    recurringExpense: { findMany: async () => [ALQUILER] },
    $transaction: async () => {
      throw new Error("conexion caida");
    },
  };

  await assert.rejects(
    () => materializeRecurringForMonth(client as any, 2026, 3),
    /conexion caida/
  );
});
