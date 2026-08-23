import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCallbackData,
  buildExpenseKeyboard,
  buildCategoryKeyboard,
  buildDeleteConfirmKeyboard,
} from "../src/lib/telegram/callbacks.ts";

const ID = "507f1f77bcf86cd799439011";
const ID2 = "aaaaaaaaaaaaaaaaaaaaaaaa";

test("las seis formas validas parsean al kind correcto", () => {
  assert.deepEqual(parseCallbackData(`sc:${ID}:personal`), {
    kind: "scope",
    expenseId: ID,
    scope: "personal",
  });
  assert.deepEqual(parseCallbackData(`sc:${ID}:casa`), {
    kind: "scope",
    expenseId: ID,
    scope: "casa",
  });
  assert.deepEqual(parseCallbackData(`cat:${ID}`), {
    kind: "categoryMenu",
    expenseId: ID,
  });
  assert.deepEqual(parseCallbackData(`cat:${ID}:${ID2}`), {
    kind: "category",
    expenseId: ID,
    categoryId: ID2,
  });
  assert.deepEqual(parseCallbackData(`del:${ID}`), {
    kind: "deleteAsk",
    expenseId: ID,
  });
  assert.deepEqual(parseCallbackData(`delok:${ID}`), {
    kind: "deleteConfirm",
    expenseId: ID,
  });
  assert.deepEqual(parseCallbackData(`cx:${ID}`), {
    kind: "cancel",
    expenseId: ID,
  });
});

test("sc mal formado devuelve null", () => {
  assert.equal(parseCallbackData(`sc:${ID}:otracosa`), null);
  assert.equal(parseCallbackData(`sc:${ID}`), null);
  assert.equal(parseCallbackData(`sc:${ID}:casa:extra`), null);
});

test("un id que no es 24 hex devuelve null en todos los tags", () => {
  const idsInvalidos = [
    "abc",
    ID.slice(0, 23), // 23 chars
    ID + "a", // 25 chars
    "g".repeat(24), // 24 chars pero no hex
  ];
  for (const id of idsInvalidos) {
    assert.equal(parseCallbackData(`sc:${id}:casa`), null, `sc con id ${id}`);
    assert.equal(parseCallbackData(`cat:${id}`), null, `cat con id ${id}`);
    assert.equal(parseCallbackData(`cat:${id}:${ID2}`), null, `cat/categoria con id ${id}`);
    assert.equal(parseCallbackData(`del:${id}`), null, `del con id ${id}`);
    assert.equal(parseCallbackData(`delok:${id}`), null, `delok con id ${id}`);
    assert.equal(parseCallbackData(`cx:${id}`), null, `cx con id ${id}`);
  }
});

test("un tag desconocido devuelve null", () => {
  assert.equal(parseCallbackData(`zzz:${ID}`), null);
});

test("null, undefined y string vacio devuelven null", () => {
  assert.equal(parseCallbackData(null), null);
  assert.equal(parseCallbackData(undefined), null);
  assert.equal(parseCallbackData(""), null);
});

test("round-trip: cada boton generado se parsea de vuelta a la accion que promete", () => {
  const expenseKeyboard = buildExpenseKeyboard(ID, "casa");
  for (const row of expenseKeyboard.inline_keyboard) {
    for (const button of row) {
      assert.notEqual(parseCallbackData(button.callback_data), null, button.callback_data);
    }
  }
  // El boton de scope ofrece ir a "personal" (destino explicito).
  assert.deepEqual(parseCallbackData(expenseKeyboard.inline_keyboard[0][0].callback_data), {
    kind: "scope",
    expenseId: ID,
    scope: "personal",
  });
  assert.deepEqual(parseCallbackData(expenseKeyboard.inline_keyboard[1][0].callback_data), {
    kind: "categoryMenu",
    expenseId: ID,
  });
  assert.deepEqual(parseCallbackData(expenseKeyboard.inline_keyboard[2][0].callback_data), {
    kind: "deleteAsk",
    expenseId: ID,
  });

  const categories = [
    { id: ID2, name: "Supermercado" },
    { id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Comida y delivery" },
  ];
  const categoryKeyboard = buildCategoryKeyboard(ID, categories);
  for (const row of categoryKeyboard.inline_keyboard) {
    for (const button of row) {
      assert.notEqual(parseCallbackData(button.callback_data), null, button.callback_data);
    }
  }
  assert.deepEqual(parseCallbackData(categoryKeyboard.inline_keyboard[0][0].callback_data), {
    kind: "category",
    expenseId: ID,
    categoryId: ID2,
  });
  const ultimaFila = categoryKeyboard.inline_keyboard[categoryKeyboard.inline_keyboard.length - 1];
  assert.deepEqual(parseCallbackData(ultimaFila[0].callback_data), {
    kind: "cancel",
    expenseId: ID,
  });

  const deleteConfirmKeyboard = buildDeleteConfirmKeyboard(ID);
  assert.deepEqual(
    parseCallbackData(deleteConfirmKeyboard.inline_keyboard[0][0].callback_data),
    { kind: "deleteConfirm", expenseId: ID }
  );
  assert.deepEqual(
    parseCallbackData(deleteConfirmKeyboard.inline_keyboard[0][1].callback_data),
    { kind: "cancel", expenseId: ID }
  );
});

test("presupuesto de 64 bytes en los tres teclados, con categorias de nombre largo", () => {
  const categoriasLargas = [
    { id: "111111111111111111111111", name: "Comida y delivery en casa" },
    { id: "222222222222222222222222", name: "Supermercado y almacen" },
    { id: "333333333333333333333333", name: "Salud, farmacia y medicos" },
    { id: "444444444444444444444444", name: "Servicios del hogar completos" },
    { id: "555555555555555555555555", name: "Ropa, calzado y accesorios" },
    { id: "666666666666666666666666", name: "Transporte publico y combustible" },
    { id: "777777777777777777777777", name: "Entretenimiento y salidas varias" },
    { id: "888888888888888888888888", name: "Mantenimiento del auto familiar" },
  ];

  const teclados = [
    buildExpenseKeyboard(ID, "casa"),
    buildCategoryKeyboard(ID, categoriasLargas),
    buildDeleteConfirmKeyboard(ID),
  ];

  for (const teclado of teclados) {
    for (const row of teclado.inline_keyboard) {
      for (const b of row) {
        assert.ok(
          Buffer.byteLength(b.callback_data) <= 64,
          `${b.callback_data} supera 64 bytes`
        );
      }
    }
  }
});

test("buildExpenseKeyboard ofrece el scope contrario al actual", () => {
  const desdeCasa = buildExpenseKeyboard(ID, "casa");
  assert.deepEqual(parseCallbackData(desdeCasa.inline_keyboard[0][0].callback_data), {
    kind: "scope",
    expenseId: ID,
    scope: "personal",
  });

  const desdePersonal = buildExpenseKeyboard(ID, "personal");
  assert.deepEqual(parseCallbackData(desdePersonal.inline_keyboard[0][0].callback_data), {
    kind: "scope",
    expenseId: ID,
    scope: "casa",
  });
});
