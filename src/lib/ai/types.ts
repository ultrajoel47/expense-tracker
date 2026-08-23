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

export type ParseResult = GastoResult | DesconocidoResult;
