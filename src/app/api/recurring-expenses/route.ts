import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createPeriodFromRecurringIfMissing, getNextPeriodMonthStart } from "@/lib/recurring-periods";

type ManualShare = { userId: string; percentage: number };

async function createRecurringShares(
  recurringExpenseId: string,
  totalAmount: number,
  splitMode: string,
  allUserIds: string[],
  manualShares: ManualShare[],
  payerId: string
) {
  if (splitMode === "manual" && manualShares.length > 0) {
    const total = manualShares.reduce((s, u) => s + u.percentage, 0);
    if (Math.abs(total - 100) > 1) return;
    const nonPayerShares = manualShares.filter((s) => s.userId !== payerId);
    if (nonPayerShares.length === 0) return;
    await prisma.recurringShare.createMany({
      data: nonPayerShares.map(({ userId, percentage }) => ({
        recurringExpenseId,
        userId,
        percentage,
        amount: (totalAmount * percentage) / 100,
      })),
    });
  } else {
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
      await prisma.recurringShare.createMany({
        data: nonPayerIds.map((uid) => {
          const userIncome = incomeMap.get(uid) ?? 0;
          const pct = (userIncome / (totalIncome as number)) * 100;
          return { recurringExpenseId, userId: uid, percentage: pct, amount: (totalAmount * pct) / 100 };
        }),
      });
    } else {
      const pct = 100 / allUserIds.length;
      await prisma.recurringShare.createMany({
        data: nonPayerIds.map((uid) => ({
          recurringExpenseId,
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
  const categoryId = url.searchParams.get("categoryId");
  const activeParam = url.searchParams.get("active"); // "true" | "false" | null

  const where: Record<string, unknown> = { userId: session.id };
  if (categoryId) where.categoryId = categoryId;
  if (activeParam === "true") where.active = true;
  if (activeParam === "false") where.active = false;

  const recurring = await prisma.recurringExpense.findMany({
    where,
    include: {
      category: { select: { id: true, name: true, color: true } },
      creditCard: { select: { id: true, name: true } },
      shares: { include: { user: { select: { id: true, name: true } } } },
      payer: { select: { id: true, name: true } },
    },
    orderBy: { nextDue: "asc" },
  });

  return NextResponse.json(recurring);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json();
  const {
    amount,
    description,
    categoryId,
    creditCardId,
    frequency,
    dayOfMonth,
    nextDue,
    isShared = false,
    splitMode = "auto",
    sharedUserIds,
    sharedUsers,
    groupId,
    payerId,
  } = body;

  if (!amount || !description || !categoryId || !frequency || !nextDue) {
    return NextResponse.json(
      { error: "Campos requeridos: amount, description, categoryId, frequency, nextDue" },
      { status: 400 }
    );
  }

  const recurring = await prisma.recurringExpense.create({
    data: {
      userId: session.id,
      payerId: payerId || null,
      amount: Number(amount),
      description,
      categoryId,
      creditCardId: creditCardId || null,
      groupId: groupId || null,
      frequency,
      dayOfMonth: dayOfMonth ? Number(dayOfMonth) : null,
      nextDue: new Date(nextDue),
      isShared: !!isShared,
      splitMode,
    },
    include: {
      category: { select: { id: true, name: true, color: true } },
      creditCard: { select: { id: true, name: true } },
    },
  });

  if (isShared) {
    const effectivePayerId = payerId || session.id;
    if (splitMode === "manual" && Array.isArray(sharedUsers) && sharedUsers.length > 0) {
      await createRecurringShares(recurring.id, Number(amount), "manual", [], sharedUsers, effectivePayerId);
    } else if (splitMode === "auto" && Array.isArray(sharedUserIds) && sharedUserIds.length > 0) {
      const allUserIds = [...new Set([effectivePayerId, ...sharedUserIds])];
      await createRecurringShares(recurring.id, Number(amount), "auto", allUserIds, [], effectivePayerId);
    } else if (groupId && (!sharedUsers || sharedUsers.length === 0) && (!sharedUserIds || sharedUserIds.length === 0)) {
      const group = await prisma.group.findFirst({
        where: { id: groupId },
        include: { members: true },
      });
      if (group) {
        const allMembers = group.members;
        const totalPct = allMembers.reduce((s: number, m: any) => s + m.percentage, 0);
        if (Math.abs(totalPct - 100) <= 1) {
          const nonPayerMembers = allMembers.filter((m: any) => m.userId !== effectivePayerId);
          if (nonPayerMembers.length > 0) {
            await prisma.recurringShare.createMany({
              data: nonPayerMembers.map((m: any) => ({
                recurringExpenseId: recurring.id,
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

  const createdRecurring = await prisma.recurringExpense.findUnique({
    where: { id: recurring.id },
    include: { shares: true },
  });

  if (
    createdRecurring &&
    createdRecurring.active &&
    createdRecurring.frequency === "MONTHLY" &&
    createdRecurring.nextDue < getNextPeriodMonthStart(new Date().getFullYear(), new Date().getMonth() + 1)
  ) {
    const now = new Date();
    await createPeriodFromRecurringIfMissing(prisma as any, createdRecurring as any, now.getFullYear(), now.getMonth() + 1);
  }

  return NextResponse.json(recurring, { status: 201 });
}
