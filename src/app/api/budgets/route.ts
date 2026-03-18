import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const url = new URL(req.url);
  const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
  const year = Number(url.searchParams.get("year") || new Date().getFullYear());

  const budgets = await prisma.budget.findMany({
    where: { userId: session.id, month, year },
    include: { category: true },
  });

  return NextResponse.json(budgets);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { amount, categoryId, month, year } = await req.json();

  if (!amount || !categoryId || !month || !year) {
    return NextResponse.json({ error: "Todos los campos son requeridos" }, { status: 400 });
  }

  const budget = await prisma.budget.upsert({
    where: {
      userId_categoryId_month_year: {
        userId: session.id,
        categoryId,
        month: Number(month),
        year: Number(year),
      },
    },
    update: { amount: Number(amount) },
    create: {
      amount: Number(amount),
      categoryId,
      month: Number(month),
      year: Number(year),
      userId: session.id,
    },
    include: { category: true },
  });

  return NextResponse.json(budget);
}
