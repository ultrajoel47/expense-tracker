import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type ManualShare = { userId: string; percentage: number };

async function createExpenseShares(
  expenseId: string,
  totalAmount: number,
  splitMode: string,
  allUserIds: string[],
  manualShares: ManualShare[],
  payerId: string
) {
  if (splitMode === "manual" && manualShares.length > 0) {
    const total = manualShares.reduce((s, u) => s + u.percentage, 0);
    if (Math.abs(total - 100) > 1) return; // invalid, skip
    const nonPayerShares = manualShares.filter((s) => s.userId !== payerId);
    if (nonPayerShares.length === 0) return;
    await prisma.expenseShare.createMany({
      data: nonPayerShares.map(({ userId, percentage }) => ({
        expenseId,
        userId,
        percentage,
        amount: (totalAmount * percentage) / 100,
      })),
    });
  } else {
    // auto: income-proportional or equal split
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const incomes = await prisma.monthlyIncome.findMany({
      where: { userId: { in: allUserIds }, month: currentMonth, year: currentYear },
    });

    const incomeMap = new Map<string, number>(incomes.map((i: any) => [i.userId, i.amount]));
    const totalIncome = allUserIds.reduce((sum: number, uid) => sum + (incomeMap.get(uid) ?? 0), 0);
    const nonPayerIds = allUserIds.filter((uid) => uid !== payerId);
    if (nonPayerIds.length === 0) return;

    if (totalIncome > 0) {
      await prisma.expenseShare.createMany({
        data: nonPayerIds.map((uid) => {
          const userIncome = incomeMap.get(uid) ?? 0;
          const pct = (userIncome / totalIncome) * 100;
          return {
            expenseId,
            userId: uid,
            percentage: pct,
            amount: (totalAmount * pct) / 100,
          };
        }),
      });
    } else {
      const pct = 100 / allUserIds.length;
      await prisma.expenseShare.createMany({
        data: nonPayerIds.map((uid) => ({
          expenseId,
          userId: uid,
          percentage: pct,
          amount: (totalAmount * pct) / 100,
        })),
      });
    }
  }
}

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
        shares: { include: { user: { select: { id: true, name: true } } } },
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
    const {
      amount,
      description,
      date,
      categoryId,
      creditCardId,
      totalInstallments,
      isShared,
      splitMode = "auto",
      sharedUserIds,
      sharedUsers,
      groupId,
    } = body;

    if (!amount || !description || !categoryId) {
      return NextResponse.json({ error: "Campos requeridos: amount, description, categoryId" }, { status: 400 });
    }

    const expenseDate = date ? new Date(date) : new Date();
    const numInstallments = totalInstallments && totalInstallments > 1 ? Number(totalInstallments) : null;
    const installmentAmount = numInstallments ? Number(amount) / numInstallments : Number(amount);

    const expense = await prisma.expense.create({
      data: {
        amount: Number(amount),
        description,
        date: expenseDate,
        categoryId,
        creditCardId: creditCardId || null,
        groupId: groupId || null,
        totalInstallments: numInstallments,
        isShared: !!isShared,
        splitMode,
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

    if (isShared) {
      if (splitMode === "manual" && Array.isArray(sharedUsers) && sharedUsers.length > 0) {
        await createExpenseShares(expense.id, Number(amount), "manual", [], sharedUsers, session.id);
      } else if (splitMode === "auto" && Array.isArray(sharedUserIds) && sharedUserIds.length > 0) {
        const allUserIds = [...new Set([session.id, ...sharedUserIds])];
        await createExpenseShares(expense.id, Number(amount), "auto", allUserIds, [], session.id);
      } else if (groupId && (!sharedUsers || sharedUsers.length === 0) && (!sharedUserIds || sharedUserIds.length === 0)) {
        // Use group members as the split source
        const group = await prisma.group.findFirst({
          where: { id: groupId },
          include: { members: true },
        });
        if (group) {
          const allMembers = group.members;
          const totalPct = allMembers.reduce((s: number, m: any) => s + m.percentage, 0);
          if (Math.abs(totalPct - 100) <= 1) {
            const nonPayerMembers = allMembers.filter((m: any) => m.userId !== session.id);
            if (nonPayerMembers.length > 0) {
              await prisma.expenseShare.createMany({
                data: nonPayerMembers.map((m: any) => ({
                  expenseId: expense.id,
                  userId: m.userId,
                  percentage: m.percentage,
                  amount: (Number(amount) * m.percentage) / 100,
                })),
              });
            }
          }
        }
      }
    }

    return NextResponse.json(expense, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Error al crear gasto" }, { status: 500 });
  }
}
