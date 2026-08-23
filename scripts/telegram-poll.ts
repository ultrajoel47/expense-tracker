/**
 * Long-poll de Telegram para probar el webhook en local, sin tunel.
 *
 * Registrar un webhook es GLOBAL por bot: si se apuntara a una URL de tunel
 * efimera (ngrok, cloudflared) para probar en local, quedaria pisando
 * cualquier webhook real que el bot tenga en produccion, y se rompe apenas el
 * tunel muere. Este script evita el problema entero: usa `getUpdates` (long
 * polling) contra la Bot API y reenvia cada update, tal cual, al route
 * handler local por HTTP — sin tocar la configuracion del webhook del bot.
 *
 * `getUpdates` y un webhook son MUTUAMENTE EXCLUYENTES: Telegram no entrega
 * por `getUpdates` mientras haya un webhook seteado. Por eso el script primero
 * chequea `getWebhookInfo` y se niega a correr si hay uno activo.
 *
 * Reenvia con el mismo header que Telegram manda de verdad
 * (X-Telegram-Bot-Api-Secret-Token), asi el route handler se ejercita
 * identico a como lo haria un webhook real.
 *
 * Es idempotente ante un Ctrl-C y reinicio: el offset solo avanza DESPUES de
 * reenviar con exito, asi que el ultimo update puede reentregarse — y esa
 * reentrega es exactamente lo que `ProcessedUpdate` (idempotencia del route
 * handler) esta hecho para absorber sin duplicar el gasto.
 *
 * Correr:  node --env-file=.env scripts/telegram-poll.ts
 * (con `npm run dev` corriendo en otra terminal)
 */
import { requireEnv } from "../src/lib/env.ts";

const TOKEN = requireEnv("TELEGRAM_BOT_TOKEN");
const SECRET = requireEnv("TELEGRAM_WEBHOOK_SECRET");
const LOCAL_WEBHOOK_URL =
  process.env.LOCAL_WEBHOOK_URL ?? "http://localhost:3000/api/telegram/webhook";
const POLL_TIMEOUT_SECONDS = 30;

function apiUrl(method: string): string {
  return `https://api.telegram.org/bot${TOKEN}/${method}`;
}

async function getWebhookInfo(): Promise<{ url: string }> {
  const res = await fetch(apiUrl("getWebhookInfo"));
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`getWebhookInfo fallo: ${JSON.stringify(json)}`);
  }
  return json.result;
}

async function getUpdates(offset: number | null): Promise<any[]> {
  const res = await fetch(apiUrl("getUpdates"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timeout: POLL_TIMEOUT_SECONDS,
      ...(offset !== null ? { offset } : {}),
    }),
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`getUpdates fallo: ${JSON.stringify(json)}`);
  }
  return json.result;
}

async function forward(update: unknown): Promise<number> {
  const res = await fetch(LOCAL_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": SECRET,
    },
    body: JSON.stringify(update),
  });
  // Se descarta el body a proposito: el route handler siempre contesta 200
  // salvo por el secret, asi que lo unico interesante para el usuario es el
  // status y lo que el propio bot mando de vuelta por sendMessage.
  await res.text();
  return res.status;
}

// Salida inmediata: el script no sostiene ningun recurso que necesite un
// shutdown prolijo (sin conexion a DB, sin archivos abiertos), y esperar a
// que termine el getUpdates en curso dejaria el Ctrl-C colgado hasta 30s
// (el timeout del long-poll).
process.on("SIGINT", () => {
  console.log("\nCortando el polling (Ctrl-C). El proximo arranque puede re-entregar el ultimo update.");
  process.exit(0);
});

async function main() {
  const webhookInfo = await getWebhookInfo();
  if (webhookInfo.url) {
    console.error(
      `Hay un webhook registrado para este bot: ${webhookInfo.url}\n` +
        "Telegram no entrega updates por getUpdates mientras un webhook este activo.\n" +
        "Para liberarlo (fuera de este script, con conocimiento del que lo puso):\n" +
        `  curl "https://api.telegram.org/bot${TOKEN}/deleteWebhook"`
    );
    process.exit(1);
  }

  console.log(`Reenviando updates a ${LOCAL_WEBHOOK_URL}`);
  console.log("Esperando mensajes en Telegram... (Ctrl-C para cortar)\n");

  let offset: number | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let updates: any[];
    try {
      updates = await getUpdates(offset);
    } catch (error) {
      console.error("Error consultando getUpdates, reintentando:", error);
      continue;
    }

    for (const update of updates) {
      console.log(`\n<- update_id=${update.update_id}`);
      console.log(JSON.stringify(update, null, 2));

      let status: number;
      try {
        status = await forward(update);
      } catch (error) {
        console.error("  Error reenviando al webhook local (sigue corriendo dev?):", error);
        // No avanzamos el offset: reintenta este mismo update la proxima vuelta.
        break;
      }
      console.log(`  -> local respondio ${status}`);

      // Avanza el offset SOLO despues de reenviar con exito, para no perder
      // un update si el fetch local falla.
      offset = update.update_id + 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
