import { requireEnv } from "../env.ts";
import type { AiProvider } from "./parse.ts";

export function createGrokProvider(): AiProvider {
  return {
    async complete(system: string, user: string): Promise<string> {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${requireEnv("XAI_API_KEY")}`,
        },
        body: JSON.stringify({
          model: process.env.XAI_MODEL || "grok-4-fast",
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(`xAI respondio ${res.status}: ${await res.text()}`);
      }

      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error(`Respuesta inesperada de xAI: ${JSON.stringify(json)}`);
      }
      return content;
    },
  };
}
