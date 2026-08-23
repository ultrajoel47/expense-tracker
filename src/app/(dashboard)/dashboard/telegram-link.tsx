"use client";

import { useEffect, useState } from "react";

/**
 * Afordancia de vinculación con el bot.
 *
 * `POST /api/telegram/link` existía desde el principio y **nada en la UI lo
 * llamaba**: no había botón, ni página, ni entrada de nav. Vincular la cuenta de
 * la segunda persona requería un POST autenticado con SU cookie de sesión, o
 * sea una consola del navegador y saber que la ruta existe. Esta tarjeta es el
 * otro extremo del flujo; el bot ya contesta un `/start` pelado con las
 * instrucciones que llevan acá.
 */

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

export default function TelegramLinkCard() {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setLinked(Boolean(d.user?.telegramLinked)))
      .catch(() => setLinked(false));
  }, []);

  async function generate() {
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo generar el codigo");
      setCode(data.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el codigo");
    } finally {
      setLoading(false);
    }
  }

  const command = code ? `/start ${code}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setError("No se pudo copiar. Selecciona el texto a mano.");
    }
  }

  // Mientras no se sabe el estado no se muestra nada, para no hacer saltar el
  // layout del dashboard con una tarjeta que puede no corresponder.
  if (linked === null) return null;

  return (
    <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border dark:border-gray-700">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium flex items-center gap-2">
            Telegram
            {linked && (
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/40 text-green-600 dark:text-green-400">
                vinculado
              </span>
            )}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {linked
              ? "Ya podes mandarle gastos al bot desde este chat."
              : "Vincula tu chat para cargar gastos escribiendole al bot."}
          </p>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition"
        >
          {loading ? "Generando..." : linked ? "Vincular de nuevo" : "Vincular Telegram"}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {code && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Mandale este mensaje al bot
            {BOT_USERNAME ? (
              <>
                {" "}
                <a
                  href={`https://t.me/${BOT_USERNAME}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline"
                >
                  @{BOT_USERNAME}
                </a>
              </>
            ) : null}
            . El codigo se usa una sola vez.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-900 text-sm font-mono break-all">
              {command}
            </code>
            <button
              onClick={copy}
              className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium border dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
