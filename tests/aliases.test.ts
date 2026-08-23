import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePattern,
  esPatronAprendible,
  loadAliasesForPrompt,
  learnAlias,
  recordAliasHit,
  PATRON_MINIMO,
  TOPE_PARA_EL_PROMPT,
  type AliasRow,
} from "../src/lib/aliases.ts";

function clienteFalso(opts: { findManyResult?: AliasRow[]; tirar?: boolean } = {}) {
  const llamadas = {
    findMany: [] as any[],
    upsert: [] as any[],
    updateMany: [] as any[],
  };
  const client = {
    alias: {
      findMany: async (args: any) => {
        llamadas.findMany.push(args);
        return opts.findManyResult ?? [];
      },
      upsert: async (args: any) => {
        llamadas.upsert.push(args);
        if (opts.tirar) throw new Error("boom");
        return {};
      },
      updateMany: async (args: any) => {
        llamadas.updateMany.push(args);
        if (opts.tirar) throw new Error("boom");
        return { count: 1 };
      },
    },
  };
  return { client, llamadas };
}

// ─── normalizePattern ────────────────────────────────────────────────────

test("normalizePattern saca acentos y pasa a minusculas", () => {
  assert.equal(normalizePattern("Panadería"), "panaderia");
});

test("'Panadería' y 'panaderia' normalizan al mismo patron", () => {
  assert.equal(normalizePattern("Panadería"), normalizePattern("panaderia"));
});

test("normalizePattern colapsa espacios multiples y recorta los bordes", () => {
  assert.equal(normalizePattern("  Juan   Perez  "), "juan perez");
});

test("normalizePattern de un string vacio o de solo espacios da string vacio", () => {
  assert.equal(normalizePattern(""), "");
  assert.equal(normalizePattern("   "), "");
});

// ─── esPatronAprendible ──────────────────────────────────────────────────

test("esPatronAprendible es false para un string vacio", () => {
  assert.equal(esPatronAprendible(""), false);
});

test("esPatronAprendible es false para un patron de dos caracteres", () => {
  assert.equal(esPatronAprendible("ab"), false);
});

test("esPatronAprendible es false para 'Sin descripcion' en cualquier capitalizacion", () => {
  assert.equal(esPatronAprendible("Sin descripcion"), false);
  assert.equal(esPatronAprendible("SIN DESCRIPCION"), false);
  assert.equal(esPatronAprendible("sin   descripcion"), false);
});

test("esPatronAprendible es true para 'juan perez'", () => {
  assert.equal(esPatronAprendible("juan perez"), true);
});

// ─── loadAliasesForPrompt ────────────────────────────────────────────────

const CATEGORIAS = [
  { id: "cat-1", name: "Comida y delivery" },
  { id: "cat-2", name: "Otros" },
];

test("loadAliasesForPrompt pide el take y el orderBy esperados", async () => {
  const { client, llamadas } = clienteFalso();
  await loadAliasesForPrompt(client, CATEGORIAS);
  assert.equal(llamadas.findMany.length, 1);
  assert.deepEqual(llamadas.findMany[0].orderBy, [{ hits: "desc" }, { createdAt: "desc" }]);
  assert.equal(llamadas.findMany[0].take, TOPE_PARA_EL_PROMPT);
});

test("loadAliasesForPrompt resuelve el nombre de la categoria", async () => {
  const { client } = clienteFalso({
    findManyResult: [
      { pattern: "juan perez", categoryId: "cat-1", description: "Juan Perez", scope: null, hits: 3 },
    ],
  });
  const resultado = await loadAliasesForPrompt(client, CATEGORIAS);
  assert.deepEqual(resultado, [
    { pattern: "juan perez", categoryName: "Comida y delivery", description: "Juan Perez", scope: null },
  ]);
});

test("loadAliasesForPrompt descarta el alias cuya categoria ya no existe", async () => {
  const { client } = clienteFalso({
    findManyResult: [
      { pattern: "juan perez", categoryId: "cat-1", description: "Juan Perez", scope: null, hits: 3 },
      { pattern: "borrada", categoryId: "cat-inexistente", description: null, scope: null, hits: 0 },
    ],
  });
  const resultado = await loadAliasesForPrompt(client, CATEGORIAS);
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].pattern, "juan perez");
});

// ─── learnAlias ──────────────────────────────────────────────────────────

test("learnAlias no escribe si no cambio ni categoria ni ambito", async () => {
  const { client, llamadas } = clienteFalso();
  const escribio = await learnAlias(client, {
    description: "Juan Perez",
    categoryId: "cat-1",
    scope: "casa",
    cambioLaCategoria: false,
    cambioElAmbito: false,
  });
  assert.equal(escribio, false);
  assert.equal(llamadas.upsert.length, 0);
});

test("learnAlias no escribe con un patron no aprendible", async () => {
  const { client, llamadas } = clienteFalso();
  const escribio = await learnAlias(client, {
    description: "ok",
    categoryId: "cat-1",
    scope: "casa",
    cambioLaCategoria: true,
    cambioElAmbito: false,
  });
  assert.equal(escribio, false);
  assert.equal(llamadas.upsert.length, 0);
});

test("learnAlias hace upsert por el pattern normalizado cuando cambio la categoria", async () => {
  const { client, llamadas } = clienteFalso();
  const escribio = await learnAlias(client, {
    description: "Juan Pérez",
    categoryId: "cat-1",
    scope: "casa",
    cambioLaCategoria: true,
    cambioElAmbito: false,
  });
  assert.equal(escribio, true);
  assert.equal(llamadas.upsert.length, 1);
  assert.deepEqual(llamadas.upsert[0].where, { pattern: "juan perez" });
  assert.equal(llamadas.upsert[0].create.pattern, "juan perez");
  assert.equal(llamadas.upsert[0].create.categoryId, "cat-1");
  assert.equal(llamadas.upsert[0].create.description, "Juan Pérez");
});

test("learnAlias no incluye scope en el update cuando el ambito no cambio", async () => {
  const { client, llamadas } = clienteFalso();
  await learnAlias(client, {
    description: "Juan Perez",
    categoryId: "cat-1",
    scope: "personal",
    cambioLaCategoria: true,
    cambioElAmbito: false,
  });
  assert.equal(llamadas.upsert.length, 1);
  const { update, create } = llamadas.upsert[0];
  assert.equal("scope" in update, false);
  assert.equal("scope" in create, false);
});

test("learnAlias incluye scope en create y en update cuando el ambito si cambio", async () => {
  const { client, llamadas } = clienteFalso();
  await learnAlias(client, {
    description: "Juan Perez",
    categoryId: "cat-1",
    scope: "personal",
    cambioLaCategoria: false,
    cambioElAmbito: true,
  });
  assert.equal(llamadas.upsert.length, 1);
  const { update, create } = llamadas.upsert[0];
  assert.equal(update.scope, "personal");
  assert.equal(create.scope, "personal");
});

test("learnAlias llama a onError y devuelve false si el cliente tira, sin propagar", async () => {
  const { client } = clienteFalso({ tirar: true });
  let capturado: unknown;
  const escribio = await learnAlias(
    client,
    {
      description: "Juan Perez",
      categoryId: "cat-1",
      scope: "casa",
      cambioLaCategoria: true,
      cambioElAmbito: false,
    },
    (error) => {
      capturado = error;
    }
  );
  assert.equal(escribio, false);
  assert.ok(capturado instanceof Error);
});

// ─── recordAliasHit ──────────────────────────────────────────────────────

test("recordAliasHit incrementa hits con el pattern normalizado y la categoryId", async () => {
  const { client, llamadas } = clienteFalso();
  await recordAliasHit(client, "Juan Pérez", "cat-1");
  assert.equal(llamadas.updateMany.length, 1);
  assert.deepEqual(llamadas.updateMany[0].where, { pattern: "juan perez", categoryId: "cat-1" });
  assert.deepEqual(llamadas.updateMany[0].data, { hits: { increment: 1 } });
});

test("recordAliasHit no propaga si el cliente tira", async () => {
  const { client } = clienteFalso({ tirar: true });
  let capturado: unknown;
  await recordAliasHit(client, "Juan Perez", "cat-1", (error) => {
    capturado = error;
  });
  assert.ok(capturado instanceof Error);
});
