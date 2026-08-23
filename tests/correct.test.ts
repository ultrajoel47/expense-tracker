import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCorrectionTarget,
  applyCorrection,
  deleteExpenseWithInstallments,
  type CorrectableExpense,
} from "../src/lib/expenses/correct.ts";

function clienteFalso(opts: { findFirstResult?: CorrectableExpense | null } = {}) {
  const llamadas = {
    findFirst: [] as any[],
    update: [] as any[],
    delete: [] as any[],
    deleteMany: [] as any[],
    createMany: [] as any[],
  };
  const client = {
    expense: {
      findFirst: async (args: any) => {
        llamadas.findFirst.push(args);
        return opts.findFirstResult ?? null;
      },
      update: async (args: any) => {
        llamadas.update.push(args);
        return {};
      },
      delete: async (args: any) => {
        llamadas.delete.push(args);
        return {};
      },
    },
    installment: {
      deleteMany: async (args: any) => {
        llamadas.deleteMany.push(args);
        return {};
      },
      createMany: async (args: any) => {
        llamadas.createMany.push(args);
        return {};
      },
    },
  };
  return { client, llamadas };
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
  // Una fila materializada no la "registro" nadie: la creo una lectura del
  // mes. Sin este filtro, abrir el dashboard el primero de mes pondria una
  // fila de alquiler adelante de la cola del respaldo. Ver el comentario de
  // `resolveCorrectionTarget`.
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

// ─── applyCorrection: reconstruccion de cuotas ──────────────────────────────

test("corregir el monto de un gasto en cuotas borra y crea las cuotas nuevas", async () => {
  const gastoEnCuotas: CorrectableExpense = {
    ...GASTO_BASE,
    amount: 300000,
    totalInstallments: 3,
  };
  const { client, llamadas } = clienteFalso();
  await applyCorrection(client, gastoEnCuotas, { amount: 150000 }, CATEGORIAS);

  assert.equal(llamadas.deleteMany.length, 1);
  assert.deepEqual(llamadas.deleteMany[0].where, { expenseId: "exp-1" });

  assert.equal(llamadas.createMany.length, 1);
  const filas = llamadas.createMany[0].data;
  assert.equal(filas.length, 3);
  for (const fila of filas) {
    assert.equal(fila.expenseId, "exp-1");
    assert.equal(fila.amount, 50000);
  }
});

test("corregir solo la descripcion de un gasto en cuotas no toca las cuotas", async () => {
  const gastoEnCuotas: CorrectableExpense = {
    ...GASTO_BASE,
    totalInstallments: 3,
  };
  const { client, llamadas } = clienteFalso();
  await applyCorrection(client, gastoEnCuotas, { description: "Otra cosa" }, CATEGORIAS);
  assert.equal(llamadas.deleteMany.length, 0);
  assert.equal(llamadas.createMany.length, 0);
});

test("corregir el monto de un gasto sin totalInstallments no toca las cuotas", async () => {
  const { client, llamadas } = clienteFalso();
  await applyCorrection(client, GASTO_BASE, { amount: 20000 }, CATEGORIAS);
  assert.equal(llamadas.deleteMany.length, 0);
  assert.equal(llamadas.createMany.length, 0);
});

test("corregir solo la fecha de un gasto en cuotas si las reconstruye, y la primera vence en el mes nuevo", async () => {
  const gastoEnCuotas: CorrectableExpense = {
    ...GASTO_BASE,
    amount: 300000,
    totalInstallments: 3,
  };
  const nuevaFecha = new Date("2026-11-05T12:00:00.000Z");
  const { client, llamadas } = clienteFalso();
  await applyCorrection(client, gastoEnCuotas, { date: nuevaFecha }, CATEGORIAS);

  assert.equal(llamadas.deleteMany.length, 1);
  assert.equal(llamadas.createMany.length, 1);
  const filas = llamadas.createMany[0].data;
  assert.equal(filas[0].dueDate.getUTCFullYear(), 2026);
  assert.equal(filas[0].dueDate.getUTCMonth(), 10); // noviembre, 0-indexado
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
      createMany: async () => ({}),
    },
  };

  await deleteExpenseWithInstallments(client, "exp-1");
  assert.deepEqual(orden, ["installment.deleteMany:exp-1", "expense.delete:exp-1"]);
});
