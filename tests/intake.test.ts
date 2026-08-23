import { test } from "node:test";
import assert from "node:assert/strict";
import { toIntake } from "../src/lib/telegram/intake.ts";

test("normaliza un mensaje de texto", () => {
  const intake = toIntake({
    update_id: 100,
    message: { message_id: 5, chat: { id: 4242 }, text: "12 lucas panaderia" },
  });
  assert.deepEqual(intake, {
    updateId: "100",
    chatId: "4242",
    text: "12 lucas panaderia",
    photoFileId: null,
    replyToMessageId: null,
    callbackData: null,
  });
});

test("toma la foto de mayor resolucion", () => {
  const intake = toIntake({
    update_id: 101,
    message: {
      message_id: 6,
      chat: { id: 4242 },
      photo: [
        { file_id: "chica", file_size: 100 },
        { file_id: "grande", file_size: 900 },
      ],
    },
  });
  assert.equal(intake?.photoFileId, "grande");
});

test("registra el mensaje al que responde", () => {
  const intake = toIntake({
    update_id: 102,
    message: {
      message_id: 7,
      chat: { id: 4242 },
      text: "eso fue personal",
      reply_to_message: { message_id: 5 },
    },
  });
  assert.equal(intake?.replyToMessageId, "5");
});

test("normaliza un callback de boton", () => {
  const intake = toIntake({
    update_id: 103,
    callback_query: {
      data: "scope:abc123",
      message: { message_id: 5, chat: { id: 4242 } },
    },
  });
  assert.equal(intake?.callbackData, "scope:abc123");
  assert.equal(intake?.chatId, "4242");
});

test("devuelve null para un update sin chat", () => {
  assert.equal(toIntake({ update_id: 104 }), null);
  assert.equal(toIntake(null), null);
});
