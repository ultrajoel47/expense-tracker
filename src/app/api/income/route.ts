import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const year = url.searchParams.get("year");

  const where: Record<string, unknown> = { userId: session.id };
  if (month) where.month = Number(month);
  if (year) where.year = Number(year);

  const incomes = await prisma.monthlyIncome.findMany({
    where,
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  return NextResponse.json(incomes);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json();
  const { amount, month, year } = body;

  if (!amount || !month || !year) {
    return NextResponse.json({ error: "Campos requeridos: amount, month, year" }, { status: 400 });
  }

  const income = await prisma.monthlyIncome.upsert({
    where: { userId_month_year: { userId: session.id, month: Number(month), year: Number(year) } },
    create: { userId: session.id, amount: Number(amount), month: Number(month), year: Number(year) },
    update: { amount: Number(amount) },
  });

  return NextResponse.json(income);
}
