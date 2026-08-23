import type { AiProvider } from "./parse.ts";
import { createGrokProvider } from "./grok.ts";

export type { AiProvider };

export function getAiProvider(): AiProvider {
  return createGrokProvider();
}
