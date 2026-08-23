import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { visibleExpensesWhere } from "@/lib/visibility";
import { getHouseholdUserIds } from "@/lib/household";
import { buildInstallments } from "@/lib/expenses/installments";
import { materializeRecurringForMonth } from "@/lib/recurring-materialize";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const householdUserIds = await getHouseholdUserIds();

  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const year = url.searchParams.get("year");

  // Perezoso: al leer un mes se crean los recurrentes que falten. Sin cron,
  // porque el free tier de Vercel los limita y el VPS usaria otro mecanismo.
  // Sin mes/anio explicitos (ej. listado sin filtro), se usa el mes actual.
  const hoy = new Date();
  await materializeRecurringForMonth(
    prisma as never,
    year ? Number(year) : hoy.getFullYear(),
    month ? Number(month) : hoy.getMonth() + 1
  );
  const categoryId = url.searchParams.get("categoryId");
  const description = url.searchParams.get("description");
  const scopeFilter = url.searchParams.get("scope");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "25")));

  const where: Record<string, unknown> = { ...visibleExpensesWhere(session.id, householdUserIds) };
  const andConditions: Record<string, unknown>[] = [];
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (scopeFilter === "casa" || scopeFilter === "personal") {
    andConditions.push({ scope: scopeFilter });
  }

  if (month && year) {
    startDate = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    endDate = new Date(Date.UTC(Number(year), Number(month), 1));
    andConditions.push({
      OR: [
        { totalInstallments: null, date: { gte: startDate, lt: endDate } },
        { totalInstallments: { lte: 1 }, date: { gte: startDate, lt: endDate } },
        { totalInstallments: { gt: 1 }, installments: { some: { dueDate: { gte: startDate, lt: endDate } } } },
      ],
    });
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
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
        payer: { select: { id: true, name: true } },
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

    const expense = await prisma.expense.create({
      data: {
        amount: Number(amount),
        description,
        date: expenseDate,
        categoryId,
        creditCardId: creditCardId || null,
        totalInstallments: numInstallments,
        // userId = quien pago, createdById = quien lo registro. Desde la web
        // son la misma persona; el bot es el que los puede separar.
        userId: session.id,
        createdById: session.id,
        scope: body.scope === "personal" ? "personal" : "casa",
        source: "web",
        installments: numInstallments
          ? { create: buildInstallments(expenseDate, Number(amount), numInstallments) }
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
