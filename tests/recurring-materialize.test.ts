import { test } from "node:test";
import assert from "node:assert/strict";
import {
  materializeRecurringForMonth,
  materializeRecurringForMonthSafely,
  periodKey,
  esPeriodoMaterializable,
  PRIMER_PERIODO_MATERIALIZABLE,
  FRECUENCIAS_MATERIALIZABLES,
} from "../src/lib/recurring-materialize.ts";

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
  const n = await materializeRecurringForMonth(client as any, 2026, 8);
  assert.equal(n, 1);
  assert.equal(creados[0].amount, 500000);
  assert.equal(creados[0].description, "Alquiler");
  assert.equal(creados[0].scope, "casa");
  assert.equal(creados[0].source, "recurring");
  assert.equal(creados[0].recurringPeriod, "2026-08");
});

test("el pagador y el creador son el userId de la plantilla", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  await materializeRecurringForMonth(client as any, 2026, 8);
  assert.equal(creados[0].userId, "u1");
  assert.equal(creados[0].createdById, "u1");
});

test("es idempotente: no duplica si ya existe el periodo", async () => {
  const { client, creados } = clienteFalso([ALQUILER], ["rec-1:2026-08"]);
  const n = await materializeRecurringForMonth(client as any, 2026, 8);
  assert.equal(n, 0);
  assert.equal(creados.length, 0);
});

test("dos corridas seguidas crean una sola vez", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  await materializeRecurringForMonth(client as any, 2026, 8);
  await materializeRecurringForMonth(client as any, 2026, 8);
  assert.equal(creados.length, 1);
});

test("no materializa un mes anterior a la creacion de la plantilla", async () => {
  // Plantilla creada MUY despues del mes pedido: el guard que se ejercita aca
  // es el de `createdAt`, no el del piso (2026-08 esta dentro de los limites).
  const nueva = { ...ALQUILER, createdAt: new Date(Date.UTC(2030, 0, 1)) };
  const { client, creados } = clienteFalso([nueva]);
  const n = await materializeRecurringForMonth(client as any, 2026, 8);
  assert.equal(n, 0, "no puede inventar un alquiler de antes de que existiera la plantilla");
  assert.equal(creados.length, 0);
});

test("la fecha del gasto es el dia 1 del periodo, a mediodia UTC", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  await materializeRecurringForMonth(client as any, 2026, 8);
  assert.equal(creados[0].date.toISOString(), "2026-08-01T12:00:00.000Z");
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

  const n = await materializeRecurringForMonth(client as any, 2026, 8);

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
    () => materializeRecurringForMonth(client as any, 2026, 8),
    /conexion caida/
  );
});

// ─── Limites temporales (piso y techo) ──────────────────────────────────────

test("no materializa un mes futuro: un mes que no paso no puede tener gastos", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  const hoy = new Date();
  const n = await materializeRecurringForMonth(client as any, hoy.getFullYear() + 1, 1);
  assert.equal(n, 0, "un click en la flecha '→' no puede crear el alquiler de un mes futuro");
  assert.equal(creados.length, 0);
});

test("no materializa el mes que viene (el limite es el mes actual, no el año)", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  const hoy = new Date();
  const siguiente = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
  const n = await materializeRecurringForMonth(
    client as any,
    siguiente.getFullYear(),
    siguiente.getMonth() + 1
  );
  assert.equal(n, 0);
  assert.equal(creados.length, 0);
});

test("no materializa un mes anterior al piso: esos meses ya tienen los recurrentes cargados a mano", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  // 2026-03 es el mes en que se crearon las 10 plantillas reales Y ya contiene
  // el alquiler y los servicios cargados a mano. Materializarlo duplicaria.
  const n = await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(n, 0, "materializar antes del piso duplicaria los recurrentes cargados a mano");
  assert.equal(creados.length, 0);
});

test("el piso es un mes fijo, no la creacion de la plantilla", async () => {
  // Plantilla creada en 2025: aun asi 2026-07 (antes del piso) no se materializa.
  const vieja = { ...ALQUILER, createdAt: new Date(Date.UTC(2024, 0, 1)) };
  const { client, creados } = clienteFalso([vieja]);
  const n = await materializeRecurringForMonth(client as any, 2026, 7);
  assert.equal(n, 0);
  assert.equal(creados.length, 0);
});

test("el mes del piso (2026-08) si se materializa", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  const n = await materializeRecurringForMonth(client as any, 2026, 8);
  assert.equal(n, 1);
  assert.equal(creados[0].recurringPeriod, "2026-08");
});

test("el mes actual sigue materializando como antes", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  const hoy = new Date();
  const n = await materializeRecurringForMonth(client as any, hoy.getFullYear(), hoy.getMonth() + 1);
  assert.equal(n, 1, "el mes en curso es el caso normal: tiene que seguir creando");
  assert.equal(creados.length, 1);
  assert.equal(creados[0].recurringPeriod, periodKey(hoy.getFullYear(), hoy.getMonth() + 1));
});

test("un mes fuera de 1-12 no crea nada (defensa en profundidad ante un mes sin validar)", async () => {
  for (const mes of [0, 13, 99, -1]) {
    const { client, creados } = clienteFalso([ALQUILER]);
    const n = await materializeRecurringForMonth(client as any, 2026, mes);
    assert.equal(n, 0, `mes ${mes} no puede materializar`);
    assert.equal(creados.length, 0, `mes ${mes} no puede materializar`);
  }
});

test("un año absurdo no crea nada", async () => {
  for (const anio of [999, 10000, NaN]) {
    const { client, creados } = clienteFalso([ALQUILER]);
    const n = await materializeRecurringForMonth(client as any, anio, 8);
    assert.equal(n, 0, `año ${anio} no puede materializar`);
    assert.equal(creados.length, 0, `año ${anio} no puede materializar`);
  }
});

test("periodoMaterializable expone los limites para los tests y los llamadores", () => {
  assert.equal(PRIMER_PERIODO_MATERIALIZABLE, "2026-08");
  assert.equal(esPeriodoMaterializable(2026, 7), false);
  assert.equal(esPeriodoMaterializable(2026, 8, new Date(2026, 7, 23)), true);
  assert.equal(esPeriodoMaterializable(2026, 9, new Date(2026, 7, 23)), false);
  assert.equal(esPeriodoMaterializable(2026, 8, new Date(2027, 0, 5)), true);
});

// ─── Mes 13 en un techo futuro: el bug que la comparacion de strings no ve ──

test("mes 13 no materializa aunque el techo ya este en 2027 (la clave '2026-13' no puede colarse por delante de '2027-01')", () => {
  // Esta es la razon REAL por la que el test de "un mes fuera de 1-12" de mas
  // arriba tiene que pasar siempre y no solo hoy: fijando `hoy` en 2027, sin
  // el guard de rango "2026-13" es >= "2026-08" (piso) y < "2027-01" (techo con
  // hoy en 2027), asi que colaba. Con el guard, se rechaza por rango antes de
  // construir la clave, sin importar que diga el reloj.
  const { client, creados } = clienteFalso([ALQUILER]);
  const hoyEn2027 = new Date(2027, 0, 5);
  assert.equal(esPeriodoMaterializable(2026, 13, hoyEn2027), false);
  return materializeRecurringForMonth(client as any, 2026, 13).then(() => {
    assert.equal(creados.length, 0);
  });
});

test("mes 99 no materializa (year=2026&month=99 no puede dar una clave admitida)", () => {
  assert.equal(esPeriodoMaterializable(2026, 99, new Date(2034, 8, 5)), false);
});

// ─── El techo se calcula en hora de Buenos Aires, no en la del proceso ──────

test("31/08 23:00 UTC (20:00 en Buenos Aires, todavia agosto) no admite septiembre", () => {
  // Con `new Date().getMonth()` en un proceso que corre en UTC (Vercel), este
  // instante ya séria septiembre y el techo admitiria de mas.
  const hoy = new Date("2026-08-31T23:00:00Z");
  assert.equal(esPeriodoMaterializable(2026, 9, hoy), false);
  assert.equal(esPeriodoMaterializable(2026, 8, hoy), true);
});

test("01/09 02:00 UTC (23:00 del 31/08 en Buenos Aires, todavia agosto alla) tampoco admite septiembre: este es el caso que fallaba antes del fix", () => {
  const hoy = new Date("2026-09-01T02:00:00Z");
  assert.equal(esPeriodoMaterializable(2026, 9, hoy), false);
  assert.equal(esPeriodoMaterializable(2026, 8, hoy), true);
});

// ─── FRECUENCIAS_MATERIALIZABLES: fuente unica con el `where` del motor ─────

test("FRECUENCIAS_MATERIALIZABLES es hoy solo MONTHLY", () => {
  assert.deepEqual([...FRECUENCIAS_MATERIALIZABLES], ["MONTHLY"]);
});

test("materializeRecurringForMonth filtra por FRECUENCIAS_MATERIALIZABLES, no por un literal aparte", async () => {
  let whereRecibido: any = null;
  const client = {
    recurringExpense: {
      findMany: async (args: any) => {
        whereRecibido = args.where;
        return [];
      },
    },
    $transaction: async (fn: any) => fn({ expense: { findFirst: async () => null, create: async () => ({}) } }),
  };

  await materializeRecurringForMonth(client as any, 2026, 8);

  assert.deepEqual(whereRecibido.frequency, { in: [...FRECUENCIAS_MATERIALIZABLES] });
});

// ─── materializeRecurringForMonthSafely: el try/catch de los call sites, ────
// ─── ahora testeable en vez de verificado solo por inspeccion ──────────────

test("materializeRecurringForMonthSafely: si materializa bien, devuelve fallo:false y no llama a onError", async () => {
  const { client } = clienteFalso([ALQUILER]);
  let onErrorLlamado = false;

  const resultado = await materializeRecurringForMonthSafely(
    client as any,
    2026,
    8,
    () => { onErrorLlamado = true; }
  );

  assert.deepEqual(resultado, { creados: 1, fallo: false });
  assert.equal(onErrorLlamado, false);
});

test("materializeRecurringForMonthSafely: si materializeRecurringForMonth tira, absorbe el error, avisa por onError y devuelve fallo:true", async () => {
  const client = {
    recurringExpense: { findMany: async () => [ALQUILER] },
    $transaction: async () => {
      throw new Error("conexion caida");
    },
  };
  const errores: unknown[] = [];

  const resultado = await materializeRecurringForMonthSafely(
    client as any,
    2026,
    8,
    (error) => errores.push(error)
  );

  assert.deepEqual(resultado, { creados: 0, fallo: true });
  assert.equal(errores.length, 1);
  assert.match((errores[0] as Error).message, /conexion caida/);
});

test("materializeRecurringForMonthSafely: un mes fuera de la ventana sigue devolviendo fallo:false (no es un error, es la ventana funcionando)", async () => {
  const { client } = clienteFalso([ALQUILER]);
  const resultado = await materializeRecurringForMonthSafely(client as any, 2026, 3, () => {
    assert.fail("no deberia llamarse onError: no materializar antes del piso no es un fallo");
  });
  assert.deepEqual(resultado, { creados: 0, fallo: false });
});
