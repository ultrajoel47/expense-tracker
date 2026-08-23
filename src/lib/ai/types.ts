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

export type ParseResult = GastoResult | DesconocidoResult | ConsultaNoSoportadaResult;
