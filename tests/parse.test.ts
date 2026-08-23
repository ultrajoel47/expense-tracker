import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMessage } from "../src/lib/ai/parse.ts";
import type { ParseContext, ParseResult } from "../src/lib/ai/types.ts";

const CTX: ParseContext = {
  categories: ["Supermercado", "Comida y delivery", "Ropa", "Otros"],
  members: [
    { id: "joel-id", name: "Joel" },
    { id: "ella-id", name: "Ana" },
  ],
  senderId: "joel-id",
  today: "2026-08-22",
  aliases: [],
};

function fakeProvider(response: string) {
  return { complete: async () => response };
}

test("parsea un gasto simple", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: "12 lucas",
      description: "Panaderia",
      date: "2026-08-22",
      categoryName: "Comida y delivery",
      scope: "casa",
      payerName: null,
      installments: null,
      cardName: null,
    })
  );

  const result = await parseMessage("12 lucas panaderia", CTX, provider);
  assert.equal(result.intent, "gasto");
  if (result.intent !== "gasto") return;
  assert.equal(result.amount, 12000);
  assert.equal(result.categoryName, "Comida y delivery");
  assert.equal(result.scope, "casa");
});

test("cae a desconocido si el JSON es invalido", async () => {
  const result = await parseMessage("hola", CTX, fakeProvider("no soy json"));
  assert.equal(result.intent, "desconocido");
});

test("cae a desconocido si el monto no se puede normalizar", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: "un rato",
      description: "algo",
      date: "2026-08-22",
      categoryName: "Otros",
      scope: "casa",
    })
  );
  const result = await parseMessage("gaste un rato", CTX, provider);
  assert.equal(result.intent, "desconocido");
});

test("cae a desconocido si la fecha es futura", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: 5000,
      description: "algo",
      date: "2026-09-01",
      categoryName: "Otros",
      scope: "casa",
    })
  );
  const result = await parseMessage("gaste 5000 manana", CTX, provider);
  assert.equal(result.intent, "desconocido");
});

test("fuerza a Otros una categoria que no existe", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: 5000,
      description: "algo",
      date: "2026-08-22",
      categoryName: "Criptomonedas",
      scope: "casa",
    })
  );
  const result = await parseMessage("5000 en cripto", CTX, provider);
  assert.equal(result.intent, "gasto");
  if (result.intent !== "gasto") return;
  assert.equal(result.categoryName, "Otros");
});

test("un scope invalido cae a casa", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: 5000,
      description: "algo",
      date: "2026-08-22",
      categoryName: "Otros",
      scope: "ambos",
    })
  );
  const result = await parseMessage("5000", CTX, provider);
  assert.equal(result.intent, "gasto");
  if (result.intent !== "gasto") return;
  assert.equal(result.scope, "casa");
});

test("extrae el pagador cuando lo nombra", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: 80000,
      description: "Zapatillas",
      date: "2026-08-22",
      categoryName: "Ropa",
      scope: "personal",
      payerName: "Joel",
    })
  );
  const result = await parseMessage("Joel compro zapatillas 80 lucas", CTX, provider);
  assert.equal(result.intent, "gasto");
  if (result.intent !== "gasto") return;
  assert.equal(result.payerName, "Joel");
  assert.equal(result.scope, "personal");
});

test("no revienta si amount viene ausente", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      description: "algo",
      date: "2026-08-22",
      categoryName: "Otros",
      scope: "casa",
    })
  );
  let result: ParseResult | undefined;
  await assert.doesNotReject(async () => {
    result = await parseMessage("gaste algo", CTX, provider);
  });
  assert.ok(result);
  assert.equal(result.intent, "desconocido");
});

test("no revienta si amount es null", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: null,
      description: "algo",
      date: "2026-08-22",
      categoryName: "Otros",
      scope: "casa",
    })
  );
  let result: ParseResult | undefined;
  await assert.doesNotReject(async () => {
    result = await parseMessage("gaste algo", CTX, provider);
  });
  assert.ok(result);
  assert.equal(result.intent, "desconocido");
});

test("no revienta si amount es un booleano", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: true,
      description: "algo",
      date: "2026-08-22",
      categoryName: "Otros",
      scope: "casa",
    })
  );
  let result: ParseResult | undefined;
  await assert.doesNotReject(async () => {
    result = await parseMessage("gaste algo", CTX, provider);
  });
  assert.ok(result);
  assert.equal(result.intent, "desconocido");
});

test("no revienta si amount es un array", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: [12000],
      description: "algo",
      date: "2026-08-22",
      categoryName: "Otros",
      scope: "casa",
    })
  );
  let result: ParseResult | undefined;
  await assert.doesNotReject(async () => {
    result = await parseMessage("gaste algo", CTX, provider);
  });
  assert.ok(result);
  assert.equal(result.intent, "desconocido");
});

test("una pregunta devuelve consulta_no_soportada, no desconocido", async () => {
  const provider = fakeProvider(JSON.stringify({ intent: "consulta_no_soportada" }));
  const r = await parseMessage("cuanto gastamos este mes?", CTX, provider);
  assert.equal(r.intent, "consulta_no_soportada");
});

test("un intent que no conocemos cae a desconocido", async () => {
  const provider = fakeProvider(JSON.stringify({ intent: "bailar" }));
  const r = await parseMessage("bailemos", CTX, provider);
  assert.equal(r.intent, "desconocido");
});

// ─── intent "correccion" ────────────────────────────────────────────────────

function patchProvider(patch: Record<string, unknown>) {
  const base = {
    amount: null,
    description: null,
    date: null,
    categoryName: null,
    scope: null,
    ...patch,
  };
  return fakeProvider(JSON.stringify({ intent: "correccion", patch: base }));
}

test("un patch de solo scope devuelve correccion con exactamente ese campo", async () => {
  const result = await parseMessage("eso fue personal", CTX, patchProvider({ scope: "personal" }));
  assert.equal(result.intent, "correccion");
  if (result.intent !== "correccion") return;
  assert.deepEqual(result.patch, { scope: "personal" });
});

test("un patch de solo monto devuelve correccion con exactamente ese campo", async () => {
  const result = await parseMessage(
    "en realidad fueron 15 lucas",
    CTX,
    patchProvider({ amount: "15 lucas" })
  );
  assert.equal(result.intent, "correccion");
  if (result.intent !== "correccion") return;
  assert.deepEqual(result.patch, { amount: 15000 });
});

test("un patch de monto y categoria devuelve correccion con exactamente esos dos campos", async () => {
  const result = await parseMessage(
    "en realidad fue en Ropa y salio 80 lucas",
    CTX,
    patchProvider({ amount: "80 lucas", categoryName: "Ropa" })
  );
  assert.equal(result.intent, "correccion");
  if (result.intent !== "correccion") return;
  assert.deepEqual(result.patch, { amount: 80000, categoryName: "Ropa" });
});

test("una categoria que no esta en ctx.categories se descarta y el resto del patch se aplica", async () => {
  const result = await parseMessage(
    "en realidad fue en Criptomonedas y 5000",
    CTX,
    patchProvider({ amount: 5000, categoryName: "Criptomonedas" })
  );
  assert.equal(result.intent, "correccion");
  if (result.intent !== "correccion") return;
  assert.deepEqual(result.patch, { amount: 5000 });
});

test("si la categoria descartada era el unico campo, el resultado es desconocido con la categoria en el reason", async () => {
  const result = await parseMessage(
    "en realidad fue en Criptomonedas",
    CTX,
    patchProvider({ categoryName: "Criptomonedas" })
  );
  assert.equal(result.intent, "desconocido");
  if (result.intent !== "desconocido") return;
  assert.match(result.reason, /Criptomonedas/);
});

test("un scope invalido en el patch de correccion se descarta, no se pierde en silencio", async () => {
  // Antes de este arreglo, un scope invalido no empujaba a `descartados` (a
  // diferencia de amount/date/categoryName): con "compartido" como unico
  // campo, el patch quedaba vacio y el motivo era el generico "no entendi que
  // queres corregir" en vez de mencionar el ambito.
  const result = await parseMessage(
    "que sea compartido",
    CTX,
    patchProvider({ scope: "compartido" })
  );
  assert.equal(result.intent, "desconocido");
  if (result.intent !== "desconocido") return;
  assert.match(result.reason, /ambito/);
});

test("un scope invalido junto con otro campo valido se descarta y el resto del patch se aplica", async () => {
  const result = await parseMessage(
    "que sea compartido y 5000",
    CTX,
    patchProvider({ scope: "compartido", amount: 5000 })
  );
  assert.equal(result.intent, "correccion");
  if (result.intent !== "correccion") return;
  assert.deepEqual(result.patch, { amount: 5000 });
});

test("un patch con todo en null devuelve desconocido", async () => {
  const result = await parseMessage("no entiendo que decis", CTX, patchProvider({}));
  assert.equal(result.intent, "desconocido");
});

test("una fecha ilegible en el patch se descarta", async () => {
  const result = await parseMessage(
    "cambiale la fecha",
    CTX,
    patchProvider({ date: "no-es-una-fecha" })
  );
  assert.equal(result.intent, "desconocido");
});

test("una fecha futura en el patch tambien se descarta (resolveDate ya la rechaza)", async () => {
  const result = await parseMessage(
    "cambiale la fecha a mañana",
    CTX,
    patchProvider({ date: "2026-09-01", amount: 5000 })
  );
  assert.equal(result.intent, "correccion");
  if (result.intent !== "correccion") return;
  assert.deepEqual(result.patch, { amount: 5000 });
});

test("patch ausente por completo no revienta y devuelve desconocido", async () => {
  const provider = fakeProvider(JSON.stringify({ intent: "correccion" }));
  let result: ParseResult | undefined;
  await assert.doesNotReject(async () => {
    result = await parseMessage("eso fue personal", CTX, provider);
  });
  assert.ok(result);
  assert.equal(result.intent, "desconocido");
});

test("no revienta si amount es un objeto", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: { v: 1 },
      description: "algo",
      date: "2026-08-22",
      categoryName: "Otros",
      scope: "casa",
    })
  );
  let result: ParseResult | undefined;
  await assert.doesNotReject(async () => {
    result = await parseMessage("gaste algo", CTX, provider);
  });
  assert.ok(result);
  assert.equal(result.intent, "desconocido");
});
