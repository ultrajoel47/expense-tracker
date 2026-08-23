import type { ExpenseScope } from "../visibility.ts";

export type { ExpenseScope };

export type ParseContext = {
  categories: string[];
  members: { id: string; name: string }[];
  senderId: string;
  /** "YYYY-MM-DD" en America/Argentina/Buenos_Aires */
  today: string;
  aliases: {
    pattern: string;
    categoryName: string;
    description: string | null;
    scope: string | null;
  }[];
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
 * mensaje sin sentido. Las consultas son de una rebanada futura: distinguir
 * este caso de "desconocido" es lo que le permite al webhook contestar "todavia
 * no puedo responder eso" en vez de "no pude registrar el gasto", que
 * confunde una funcion inexistente con una falla.
 */
export type ConsultaNoSoportadaResult = {
  intent: "consulta_no_soportada";
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
  | CorreccionResult;
