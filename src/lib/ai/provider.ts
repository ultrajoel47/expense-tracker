import type { AiProvider } from "./parse.ts";
import { createGrokProvider } from "./grok.ts";
import { createGroqProvider } from "./groq.ts";

export type { AiProvider };

/**
 * Selecciona la implementacion de AiProvider por AI_PROVIDER. Default "groq":
 * es el proveedor que el usuario eligio usar (la cuenta de xAI/Grok no tiene
 * creditos). "grok" queda disponible como alternativa explicita si en algun
 * momento se activa esa cuenta.
 */
export function getAiProvider(): AiProvider {
  if (process.env.AI_PROVIDER === "grok") {
    return createGrokProvider();
  }
  return createGroqProvider();
}
