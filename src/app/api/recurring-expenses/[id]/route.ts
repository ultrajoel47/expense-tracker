import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type ManualShare = { userId: string; percentage: number };

async function recreateRecurringShares(
  recurringExpenseId: string,
  totalAmount: number,
  splitMode: string,
  allUserIds: string[],
  manualShares: ManualShare[],
  payerId: string
) {
  await prisma.recurringShare.deleteMany({ where: { recurringExpenseId } });

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

    const incomeMap = new Map(incomes.map((i) => [i.userId, i.amount]));
    const totalIncome = allUserIds.reduce((sum, uid) => sum + (incomeMap.get(uid) ?? 0), 0);
    const nonPayerIds = allUserIds.filter((uid) => uid !== payerId);
    if (nonPayerIds.length === 0) return;

    if (totalIncome > 0) {
      await prisma.recurringShare.createMany({
        data: nonPayerIds.map((uid) => {
          const userIncome = incomeMap.get(uid) ?? 0;
          const pct = (userIncome / totalIncome) * 100;
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

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const rec = await prisma.recurringExpense.findFirst({
    where: { id, userId: session.id },
    include: { shares: true, payer: { select: { id: true, name: true } } },
  });
  if (!rec) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json();
  const { isShared, splitMode = "auto", sharedUserIds, sharedUsers } = body;

  // Detect significant changes to create a period snapshot
  const hasSignificantChange =
    (body.amount !== undefined && Number(body.amount) !== rec.amount) ||
    (body.description !== undefined && body.description !== rec.description) ||
    (body.categoryId !== undefined && body.categoryId !== rec.categoryId) ||
    (body.splitMode !== undefined && body.splitMode !== rec.splitMode) ||
    (isShared !== undefined && !!isShared !== rec.isShared) ||
    (body.payerId !== undefined && (body.payerId || null) !== (rec.payerId || null));

  if (hasSignificantChange) {
    // Find the last period to determine periodStart
    const lastPeriod = await prisma.recurringExpensePeriod.findFirst({
      where: { recurringExpenseId: id },
      orderBy: { periodStart: "desc" },
    });

    const periodStart = lastPeriod
      ? (() => {
          const d = new Date(lastPeriod.periodStart);
          d.setMonth(d.getMonth() + 1);
          return d;
        })()
      : rec.createdAt;

    // Create period snapshot of current configuration
    const period = await prisma.recurringExpensePeriod.create({
      data: {
        recurringExpenseId: id,
        periodStart,
        amount: rec.amount,
        description: rec.description,
        categoryId: rec.categoryId,
        splitMode: rec.splitMode,
        payerId: rec.payerId ?? null,
      },
    });

    // Copy current shares to period
    if (rec.shares.length > 0) {
      await prisma.periodShare.createMany({
        data: rec.shares.map((s) => ({
          periodId: period.id,
          userId: s.userId,
          percentage: s.percentage,
          amount: s.amount,
        })),
      });
    }
  }

  const updated = await prisma.recurringExpense.update({
    where: { id },
    data: {
      amount: body.amount ? Number(body.amount) : undefined,
      description: body.description || undefined,
      categoryId: body.categoryId || undefined,
      creditCardId: body.creditCardId !== undefined ? body.creditCardId || null : undefined,
      groupId: body.groupId !== undefined ? body.groupId || null : undefined,
      frequency: body.frequency || undefined,
      dayOfMonth: body.dayOfMonth !== undefined ? Number(body.dayOfMonth) || null : undefined,
      nextDue: body.nextDue ? new Date(body.nextDue) : undefined,
      active: body.active !== undefined ? Boolean(body.active) : undefined,
      isShared: isShared !== undefined ? !!isShared : undefined,
      splitMode: isShared !== undefined ? splitMode : undefined,
      payerId: body.payerId !== undefined ? body.payerId || null : undefined,
    },
    include: {
      category: { select: { id: true, name: true, color: true } },
      creditCard: { select: { id: true, name: true } },
      shares: { include: { user: { select: { id: true, name: true } } } },
    },
  });

  const totalAmount = body.amount ? Number(body.amount) : rec.amount;

  if (isShared === false) {
    await prisma.recurringShare.deleteMany({ where: { recurringExpenseId: id } });
  } else if (isShared === true) {
    const effectivePayerId = body.payerId ?? rec.payerId ?? session.id;
    if (splitMode === "manual" && Array.isArray(sharedUsers) && sharedUsers.length > 0) {
      await recreateRecurringShares(id, totalAmount, "manual", [], sharedUsers, effectivePayerId);
    } else if (splitMode === "auto" && Array.isArray(sharedUserIds) && sharedUserIds.length > 0) {
      const allUserIds = [...new Set([effectivePayerId, ...sharedUserIds])];
      await recreateRecurringShares(id, totalAmount, "auto", allUserIds, [], effectivePayerId);
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const rec = await prisma.recurringExpense.findFirst({ where: { id, userId: session.id } });
  if (!rec) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // Delete period shares and periods first
  const periods = await prisma.recurringExpensePeriod.findMany({ where: { recurringExpenseId: id }, select: { id: true } });
  for (const period of periods) {
    await prisma.periodShare.deleteMany({ where: { periodId: period.id } });
  }
  await prisma.recurringExpensePeriod.deleteMany({ where: { recurringExpenseId: id } });
  await prisma.recurringShare.deleteMany({ where: { recurringExpenseId: id } });
  await prisma.recurringExpense.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
