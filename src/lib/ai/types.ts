import type { ExpenseScope } from "../visibility.ts";

export type { ExpenseScope };

/**
 * Un alias tal como lo necesita el prompt: el nombre de categoria ya resuelto
 * (no el `categoryId` de la fila de `Alias`), listo para inyectarse como
 * texto.
 *
 * Declarado ACA, no en `src/lib/aliases.ts`, para que exista una sola fuente.
 * Antes este mismo shape estaba escrito dos veces (el tipo inline de
 * `ParseContext.aliases` y `AliasForPrompt` en `aliases.ts`): TypeScript los
 * unificaba por estructura sin avisar, asi que uno de los dos podia divergir
 * sin que ningun error lo marcara.
 */
export type AliasForPrompt = {
  pattern: string;
  categoryName: string;
  description: string | null;
};

export type ParseContext = {
  categories: string[];
  members: { id: string; name: string }[];
  senderId: string;
  /** "YYYY-MM-DD" en America/Argentina/Buenos_Aires */
  today: string;
  aliases: AliasForPrompt[];
};

export type GastoResult = {
  intent: "gasto";
  amount: number;
  description: string;
  date: Date;
  categoryName: string;
  scope: ExpenseScope;
  payerName: string | null;
  installments: number | null;
  cardName: string | null;
};

export type DesconocidoResult = {
  intent: "desconocido";
  reason: string;
};

/**
 * El mensaje es una PREGUNTA sobre gastos ya registrados ("cuanto gastamos
 * este mes", "mostrame los de tal categoria"), no un gasto nuevo ni un
 * mensaje sin sentido, pero no se puede convertir en una `ConsultaQuery`
 * valida: distinguir este caso de "desconocido" es lo que le permite al
 * webhook contestar sobre la PREGUNTA en vez de "no pude registrar el
 * gasto", que confunde una consulta con un intento de carga fallido.
 *
 * Se llega aca desde dos lugares distintos: la IA puede devolver este intent
 * directamente, o el codigo puede degradar un intent "consulta" hasta aca
 * cuando `buildConsulta` (`src/lib/ai/parse.ts`) rechaza la metrica, las
 * fechas o la categoria que la IA propuso.
 */
export type ConsultaNoSoportadaResult = {
  intent: "consulta_no_soportada";
  /**
   * Por que no se puede responder, cuando se sabe. Sin esto, una pregunta que
   * el codigo rechaza por una razon concreta (una categoria que no existe, un
   * rango invertido) recibe el mismo "todavia no puedo responder preguntas" que
   * una metrica no implementada, y la persona no tiene con que corregir su
   * pregunta.
   */
  reason?: string;
};

export type ConsultaMetric = "total" | "por_categoria" | "tendencia";

/**
 * Una consulta ya validada: fechas reales, metrica conocida, categoria que
 * existe. La IA nunca ve un numero de esto — solo traduce la pregunta.
 */
export type ConsultaQuery = {
  metric: ConsultaMetric;
  from: Date;
  to: Date;
  categoryName: string | null;
  scope: ExpenseScope | null;
};

export type ConsultaResult = {
  intent: "consulta";
  query: ConsultaQuery;
};

/**
 * Los campos que una correccion puede cambiar. Deliberadamente NO incluye
 * pagador, tarjeta ni cuotas: son los que cambian la identidad o la estructura
 * del gasto, y por texto libre no hay forma de distinguir "lo pago Vir" como
 * correccion de un gasto nuevo de Vir. Se corrigen en la web.
 */
export type CorreccionPatch = {
  amount?: number;
  description?: string;
  date?: Date;
  categoryName?: string;
  scope?: ExpenseScope;
};

/**
 * El mensaje corrige un gasto YA registrado.
 *
 * No lleva el gasto objetivo: el spec preveia un `target: "ultimo" |
 * { expenseId }`, pero la IA no puede conocer un ObjectId, asi que un campo
 * asi solo le daria la oportunidad de inventar uno. **El objetivo lo resuelve
 * el codigo** (por reply, si no por ultimo gasto registrado), en
 * `resolveCorrectionTarget`.
 */
export type CorreccionResult = {
  intent: "correccion";
  patch: CorreccionPatch;
};

export type ParseResult =
  | GastoResult
  | DesconocidoResult
  | ConsultaNoSoportadaResult
  | ConsultaResult
  | CorreccionResult;
