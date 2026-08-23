import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCorrectionTarget,
  applyCorrection,
  deleteExpenseWithInstallments,
  rebuildInstallments,
  type CorrectableExpense,
} from "../src/lib/expenses/correct.ts";

type FilaFalsa = {
  expenseId: string;
  installmentNumber: number;
  amount: number;
  dueDate: Date;
  paid?: boolean;
  paidAt?: Date | null;
};

/**
 * `installmentsStore` simula la tabla real (una fila por expenseId +
 * installmentNumber, con `paid`/`paidAt`) para poder verificar que el upsert
 * preserva el estado de pago, no solo que se llamo con ciertos argumentos.
 * `$transaction` corre el callback contra el mismo `installment`/`expense`
 * que ve el cliente de afuera: alcanza para probar el efecto de la
 * reconstruccion en este commit; el test que prueba que las escrituras van
 * POR el `tx` y no por el cliente de afuera se agrega junto con la
 * transaccion propia de `applyCorrection`/`deleteExpenseWithInstallments`.
 */
function clienteFalso(
  opts: { findFirstResult?: CorrectableExpense | null; installments?: FilaFalsa[] } = {}
) {
  const llamadas = {
    findFirst: [] as any[],
    update: [] as any[],
    delete: [] as any[],
    deleteMany: [] as any[],
    upsert: [] as any[],
  };

  const installmentsStore = new Map<string, any>();
  for (const row of opts.installments ?? []) {
    installmentsStore.set(`${row.expenseId}:${row.installmentNumber}`, {
      ...row,
      paid: row.paid ?? false,
      paidAt: row.paidAt ?? null,
    });
  }

  const installmentOps = {
    upsert: async (args: any) => {
      llamadas.upsert.push(args);
      const { expenseId, installmentNumber } = args.where.expenseId_installmentNumber;
      const key = `${expenseId}:${installmentNumber}`;
      const existing = installmentsStore.get(key);
      if (existing) {
        Object.assign(existing, args.update);
        return existing;
      }
      const created = { ...args.create, paid: false, paidAt: null };
      installmentsStore.set(key, created);
      return created;
    },
    deleteMany: async (args: any) => {
      llamadas.deleteMany.push(args);
      const { expenseId, installmentNumber } = args.where;
      for (const [key, row] of [...installmentsStore.entries()]) {
        if (row.expenseId !== expenseId) continue;
        if (installmentNumber?.gt !== undefined && row.installmentNumber <= installmentNumber.gt) continue;
        installmentsStore.delete(key);
      }
      return {};
    },
  };

  const expenseOps = {
    update: async (args: any) => {
      llamadas.update.push(args);
      return {};
    },
    delete: async (args: any) => {
      llamadas.delete.push(args);
      return {};
    },
  };

  const client = {
    expense: {
      findFirst: async (args: any) => {
        llamadas.findFirst.push(args);
        return opts.findFirstResult ?? null;
      },
      ...expenseOps,
    },
    installment: installmentOps,
    $transaction: async (fn: any) => fn({ expense: expenseOps, installment: installmentOps }),
  };

  return { client, llamadas, installmentsStore };
}

const GASTO_BASE: CorrectableExpense = {
  id: "exp-1",
  amount: 12000,
  description: "Panaderia",
  date: new Date("2026-08-10T12:00:00.000Z"),
  scope: "casa",
  userId: "u1",
  createdById: "u1",
  categoryId: "cat-1",
  totalInstallments: null,
  botChatId: "chat-1",
  botMessageId: "msg-1",
};

// ─── resolveCorrectionTarget ─────────────────────────────────────────────────

test("resolveCorrectionTarget con reply busca por botChatId + botMessageId y devuelve ese gasto", async () => {
  const { client, llamadas } = clienteFalso({ findFirstResult: GASTO_BASE });
  const result = await resolveCorrectionTarget(client, "u1", "chat-1", "msg-1");
  assert.deepEqual(result, { expense: GASTO_BASE });
  assert.equal(llamadas.findFirst.length, 1);
  assert.deepEqual(llamadas.findFirst[0].where, { botChatId: "chat-1", botMessageId: "msg-1" });
});

test("un reply que no matchea nada devuelve reply_desconocido y no cae al ultimo gasto", async () => {
  const { client, llamadas } = clienteFalso({ findFirstResult: null });
  const result = await resolveCorrectionTarget(client, "u1", "chat-1", "msg-viejo");
  assert.deepEqual(result, { expense: null, reason: "reply_desconocido" });
  // Solo la consulta por reply: no debe haber una segunda consulta por "ultimo gasto".
  assert.equal(llamadas.findFirst.length, 1);
});

test("sin reply busca por createdById con orderBy createdAt desc, y el where no menciona userId", async () => {
  const { client, llamadas } = clienteFalso({ findFirstResult: GASTO_BASE });
  const result = await resolveCorrectionTarget(client, "u1", "chat-1", null);
  assert.deepEqual(result, { expense: GASTO_BASE });
  assert.equal(llamadas.findFirst.length, 1);
  const { where, orderBy } = llamadas.findFirst[0];
  assert.deepEqual(where, { createdById: "u1", source: { not: "recurring" } });
  assert.equal("userId" in where, false);
  assert.deepEqual(orderBy, { createdAt: "desc" });
});

test("sin reply, el respaldo excluye las filas materializadas (source: recurring)", async () => {
  const { client, llamadas } = clienteFalso({ findFirstResult: GASTO_BASE });
  await resolveCorrectionTarget(client, "u1", "chat-1", null);
  const { where } = llamadas.findFirst[0];
  assert.deepEqual(where.source, { not: "recurring" });
});

test("sin reply y sin gastos devuelve sin_gastos", async () => {
  const { client } = clienteFalso({ findFirstResult: null });
  const result = await resolveCorrectionTarget(client, "u1", "chat-1", null);
  assert.deepEqual(result, { expense: null, reason: "sin_gastos" });
});

// ─── applyCorrection: merge de campos ───────────────────────────────────────

const CATEGORIAS = [
  { id: "cat-1", name: "Comida y delivery" },
  { id: "cat-2", name: "Ropa" },
];

test("un patch parcial deja los campos no tocados en su valor original", async () => {
  const { client, llamadas } = clienteFalso();
  const resultado = await applyCorrection(client, GASTO_BASE, { scope: "personal" }, CATEGORIAS);
  assert.deepEqual(resultado, {
    amount: GASTO_BASE.amount,
    description: GASTO_BASE.description,
    date: GASTO_BASE.date,
    scope: "personal",
    categoryId: GASTO_BASE.categoryId,
  });
  assert.equal(llamadas.update.length, 1);
  assert.deepEqual(llamadas.update[0].data, resultado);
});

test("applyCorrection resuelve categoryName al id correcto", async () => {
  const { client } = clienteFalso();
  const resultado = await applyCorrection(client, GASTO_BASE, { categoryName: "Ropa" }, CATEGORIAS);
  assert.equal(resultado.categoryId, "cat-2");
});

test("un categoryName que no esta en la lista deja el categoryId original", async () => {
  const { client } = clienteFalso();
  const resultado = await applyCorrection(
    client,
    GASTO_BASE,
    { categoryName: "Inventada" },
    CATEGORIAS
  );
  assert.equal(resultado.categoryId, GASTO_BASE.categoryId);
});

// ─── applyCorrection / rebuildInstallments: reconstruccion de cuotas ────────

test("corregir el monto de un gasto en 3 cuotas con la 2 pagada preserva paid y paidAt, y actualiza el monto de las 3", async () => {
  // Este es el test que impide que alguien "simplifique" el upsert de vuelta
  // a un delete+create: con delete+create, las 3 cuotas volverian a
  // paid:false sin dejar rastro.
  const paidAt = new Date("2026-05-01T00:00:00.000Z");
  const gastoEnCuotas: CorrectableExpense = {
    ...GASTO_BASE,
    amount: 300000,
    totalInstallments: 3,
  };
  const { client, installmentsStore } = clienteFalso({
    installments: [
      { expenseId: "exp-1", installmentNumber: 1, amount: 100000, dueDate: new Date("2026-08-01T12:00:00Z") },
      {
        expenseId: "exp-1",
        installmentNumber: 2,
        amount: 100000,
        dueDate: new Date("2026-09-01T12:00:00Z"),
        paid: true,
        paidAt,
      },
      { expenseId: "exp-1", installmentNumber: 3, amount: 100000, dueDate: new Date("2026-10-01T12:00:00Z") },
    ],
  });

  await applyCorrection(client, gastoEnCuotas, { amount: 150000 }, CATEGORIAS);

  const fila1 = installmentsStore.get("exp-1:1");
  const fila2 = installmentsStore.get("exp-1:2");
  const fila3 = installmentsStore.get("exp-1:3");

  assert.equal(fila1.amount, 50000);
  assert.equal(fila2.amount, 50000);
  assert.equal(fila3.amount, 50000);

  // La cuota 2 sigue pagada, con su paidAt intacto.
  assert.equal(fila2.paid, true);
  assert.deepEqual(fila2.paidAt, paidAt);
  // Las otras dos no se vieron afectadas en su estado de pago.
  assert.equal(fila1.paid, false);
  assert.equal(fila3.paid, false);
});

test("bajar la cantidad de cuotas borra las filas sobrantes", async () => {
  const { client, installmentsStore } = clienteFalso({
    installments: [
      { expenseId: "exp-1", installmentNumber: 1, amount: 100000, dueDate: new Date("2026-08-01T12:00:00Z") },
      { expenseId: "exp-1", installmentNumber: 2, amount: 100000, dueDate: new Date("2026-09-01T12:00:00Z") },
      { expenseId: "exp-1", installmentNumber: 3, amount: 100000, dueDate: new Date("2026-10-01T12:00:00Z") },
    ],
  });

  await rebuildInstallments(client, "exp-1", new Date("2026-08-01T12:00:00Z"), 200000, 2);

  assert.equal(installmentsStore.has("exp-1:1"), true);
  assert.equal(installmentsStore.has("exp-1:2"), true);
  assert.equal(installmentsStore.has("exp-1:3"), false);
});

test("un gasto que deja de ser en cuotas queda sin ninguna cuota", async () => {
  const { client, installmentsStore } = clienteFalso({
    installments: [
      { expenseId: "exp-1", installmentNumber: 1, amount: 100000, dueDate: new Date("2026-08-01T12:00:00Z") },
      { expenseId: "exp-1", installmentNumber: 2, amount: 100000, dueDate: new Date("2026-09-01T12:00:00Z") },
    ],
  });

  await rebuildInstallments(client, "exp-1", new Date("2026-08-01T12:00:00Z"), 200000, 0);

  assert.equal(installmentsStore.has("exp-1:1"), false);
  assert.equal(installmentsStore.has("exp-1:2"), false);
});

test("corregir solo la descripcion de un gasto en cuotas no toca las cuotas", async () => {
  const gastoEnCuotas: CorrectableExpense = {
    ...GASTO_BASE,
    totalInstallments: 3,
  };
  const { client, llamadas } = clienteFalso();
  await applyCorrection(client, gastoEnCuotas, { description: "Otra cosa" }, CATEGORIAS);
  assert.equal(llamadas.upsert.length, 0);
  assert.equal(llamadas.deleteMany.length, 0);
});

test("corregir el monto de un gasto sin totalInstallments no toca las cuotas", async () => {
  const { client, llamadas } = clienteFalso();
  await applyCorrection(client, GASTO_BASE, { amount: 20000 }, CATEGORIAS);
  assert.equal(llamadas.upsert.length, 0);
  assert.equal(llamadas.deleteMany.length, 0);
});

test("corregir solo la fecha de un gasto en cuotas si las reconstruye, y la primera vence en el mes nuevo", async () => {
  const gastoEnCuotas: CorrectableExpense = {
    ...GASTO_BASE,
    amount: 300000,
    totalInstallments: 3,
  };
  const nuevaFecha = new Date("2026-11-05T12:00:00.000Z");
  const { client, installmentsStore } = clienteFalso();
  await applyCorrection(client, gastoEnCuotas, { date: nuevaFecha }, CATEGORIAS);

  const fila1 = installmentsStore.get("exp-1:1");
  assert.equal(fila1.dueDate.getUTCFullYear(), 2026);
  assert.equal(fila1.dueDate.getUTCMonth(), 10); // noviembre, 0-indexado
});

// ─── deleteExpenseWithInstallments ───────────────────────────────────────────

test("deleteExpenseWithInstallments borra las cuotas antes que el gasto", async () => {
  const orden: string[] = [];
  const client = {
    expense: {
      findFirst: async () => null,
      update: async () => ({}),
      delete: async (args: any) => {
        orden.push("expense.delete:" + args.where.id);
        return {};
      },
    },
    installment: {
      deleteMany: async (args: any) => {
        orden.push("installment.deleteMany:" + args.where.expenseId);
        return {};
      },
      upsert: async () => ({}),
    },
    $transaction: async (fn: any) => fn(client),
  };

  await deleteExpenseWithInstallments(client as any, "exp-1");
  assert.deepEqual(orden, ["installment.deleteMany:exp-1", "expense.delete:exp-1"]);
});
