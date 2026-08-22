import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const year = url.searchParams.get("year");
  const categoryId = url.searchParams.get("categoryId");
  const description = url.searchParams.get("description");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "25")));

  const where: Record<string, unknown> = { userId: session.id };
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (month && year) {
    startDate = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    endDate = new Date(Date.UTC(Number(year), Number(month), 1));
    where.OR = [
      { totalInstallments: null, date: { gte: startDate, lt: endDate } },
      { totalInstallments: { lte: 1 }, date: { gte: startDate, lt: endDate } },
      { totalInstallments: { gt: 1 }, installments: { some: { dueDate: { gte: startDate, lt: endDate } } } },
    ];
  }

  if (categoryId) {
    where.categoryId = categoryId;
  }

  if (description?.trim()) {
    where.description = { contains: description.trim(), mode: "insensitive" };
  }

  const [total, expenses] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      include: {
        category: true,
        creditCard: { select: { id: true, name: true, color: true } },
        installments: { orderBy: { installmentNumber: "asc" } },
      },
      orderBy: { date: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const data = expenses.map((exp: any) => {
    if (!startDate || !endDate || !exp.totalInstallments || exp.totalInstallments <= 1) return exp;
    const currentInstallment = exp.installments.find(
      (inst: any) => inst.dueDate >= startDate! && inst.dueDate < endDate!
    ) ?? null;
    return { ...exp, currentInstallment };
  });

  return NextResponse.json({
    data,
    meta: { total, page, totalPages: Math.ceil(total / limit), limit },
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const body = await req.json();
    const { amount, description, date, categoryId, creditCardId, totalInstallments } = body;

    if (!amount || !description || !categoryId) {
      return NextResponse.json(
        { error: "Campos requeridos: amount, description, categoryId" },
        { status: 400 }
      );
    }

    const expenseDate = date ? new Date(date) : new Date();
    const numInstallments =
      totalInstallments && totalInstallments > 1 ? Number(totalInstallments) : null;
    const installmentAmount = numInstallments
      ? Number(amount) / numInstallments
      : Number(amount);

    const expense = await prisma.expense.create({
      data: {
        amount: Number(amount),
        description,
        date: expenseDate,
        categoryId,
        creditCardId: creditCardId || null,
        totalInstallments: numInstallments,
        userId: session.id,
        installments: numInstallments
          ? {
              create: Array.from({ length: numInstallments }, (_, i) => {
                const due = new Date(expenseDate);
                due.setMonth(due.getMonth() + i);
                return {
                  installmentNumber: i + 1,
                  dueDate: due,
                  amount: installmentAmount,
                };
              }),
            }
          : undefined,
      },
      include: {
        category: true,
        installments: { orderBy: { installmentNumber: "asc" } },
      },
    });

    return NextResponse.json(expense, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Error al crear gasto" }, { status: 500 });
  }
}
