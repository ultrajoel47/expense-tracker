import { requireEnv } from "../env.ts";
import type { AiProvider } from "./parse.ts";

/**
 * A diferencia de XAI_MODEL, GROQ_MODEL no tiene fallback hardcodeado: no
 * sabemos que modelos expone la cuenta de Groq del usuario, y adivinar un
 * nombre produce un 404 silencioso mas adelante. Mejor fallar fuerte aca,
 * con el comando para listar los modelos disponibles.
 */
function requireGroqModel(): string {
  const model = process.env.GROQ_MODEL;
  if (!model) {
    throw new Error(
      "Falta la variable de entorno GROQ_MODEL. Elegi uno de los modelos que " +
        "tu cuenta de Groq tiene disponibles y definilo en el .env. Para " +
        "listarlos: curl -s https://api.groq.com/openai/v1/models " +
        '-H "Authorization: Bearer $GROQ_API_KEY"'
    );
  }
  return model;
}

export function createGroqProvider(): AiProvider {
  return {
    async complete(system: string, user: string): Promise<string> {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${requireEnv("GROQ_API_KEY")}`,
        },
        body: JSON.stringify({
          model: requireGroqModel(),
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(`Groq respondio ${res.status}: ${await res.text()}`);
      }

      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error(`Respuesta inesperada de Groq: ${JSON.stringify(json)}`);
      }
      return content;
    },
  };
}
