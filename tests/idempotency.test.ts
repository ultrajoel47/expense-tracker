import { test } from "node:test";
import assert from "node:assert/strict";
import { claimUpdate } from "../src/lib/idempotency.ts";

test("claimUpdate devuelve true la primera vez que se crea el registro", async () => {
  const client = {
    processedUpdate: {
      create: async () => ({}),
    },
  };
  assert.equal(await claimUpdate(client, "1"), true);
});

test("claimUpdate devuelve false ante una violacion de indice unico (P2002)", async () => {
  const client = {
    processedUpdate: {
      create: async () => {
        throw { code: "P2002", message: "Unique constraint failed" };
      },
    },
  };
  assert.equal(await claimUpdate(client, "1"), false);
});

test("claimUpdate relanza un error transitorio de base de datos en vez de tratarlo como duplicado", async () => {
  const client = {
    processedUpdate: {
      create: async () => {
        throw new Error("connection reset by peer");
      },
    },
  };
  await assert.rejects(() => claimUpdate(client, "1"), /connection reset by peer/);
});
