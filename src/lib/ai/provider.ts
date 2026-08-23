import type { AiProvider } from "./parse";
import { createGrokProvider } from "./grok";

export type { AiProvider };

export function getAiProvider(): AiProvider {
  return createGrokProvider();
}
