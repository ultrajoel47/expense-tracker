import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureRecurringPeriodsForMonth, getNextPeriodMonthStart, getPeriodMonthStart } from "@/lib/recurring-periods";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const now = new Date();
  const month = parseInt(url.searchParams.get("month") ?? String(now.getMonth() + 1));
  const year = parseInt(url.searchParams.get("year") ?? String(now.getFullYear()));

  const group = await prisma.group.findFirst({
    where: {
      id,
      OR: [{ ownerId: session.id }, { members: { some: { userId: session.id } } }],
    },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      owner: { select: { id: true, name: true } },
    },
  });
  if (!group) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });

  const startOfMonth = getPeriodMonthStart(year, month);
  const startOfNextMonth = getNextPeriodMonthStart(year, month);

  await ensureRecurringPeriodsForMonth(prisma as any, { year, month, groupId: id });

  const [expenses, recurringPeriods, incomes] = await Promise.all([
    prisma.expense.findMany({
      where: {
        groupId: id,
        isShared: true,
        OR: [
          { totalInstallments: null, date: { gte: startOfMonth, lt: startOfNextMonth } },
          { totalInstallments: { lte: 1 }, date: { gte: startOfMonth, lt: startOfNextMonth } },
          { totalInstallments: { gt: 1 }, installments: { some: { dueDate: { gte: startOfMonth, lt: startOfNextMonth } } } },
        ],
      },
      include: {
        category: { select: { id: true, name: true, color: true } },
        shares: { include: { user: { select: { id: true, name: true } } } },
        installments: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
    }),
    prisma.recurringExpensePeriod.findMany({
      where: {
        periodStart: { gte: startOfMonth, lt: startOfNextMonth },
        recurringExpense: { groupId: id, isShared: true },
      },
      include: {
        shares: { include: { user: { select: { id: true, name: true } } } },
        payer: { select: { id: true, name: true } },
        recurringExpense: {
          select: {
            id: true,
            userId: true,
            frequency: true,
            user: { select: { id: true, name: true } },
            payer: { select: { id: true, name: true } },
            category: { select: { id: true, name: true, color: true } },
          },
        },
      },
      orderBy: { periodStart: "asc" },
    }),
    prisma.monthlyIncome.findMany({
      where: {
        userId: { in: group.members.map((m: any) => m.userId) },
        month,
        year,
      },
    }),
  ]);

  const categoryIds = [...new Set(recurringPeriods.map((period: any) => period.categoryId))];
  const recurringCategories = categoryIds.length
    ? await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true, color: true } })
    : [];
  const recurringCategoryMap = new Map(recurringCategories.map((category: any) => [category.id, category]));

  const totalGroupExpenses =
    expenses.reduce((sum: number, e: any) => {
      if (e.totalInstallments && e.totalInstallments > 1) {
        const active = e.installments.find(
          (inst: any) => inst.dueDate >= startOfMonth && inst.dueDate < startOfNextMonth
        );
        return sum + (active?.amount ?? e.amount);
      }
      return sum + e.amount;
    }, 0) + recurringPeriods.reduce((sum: number, r: any) => sum + r.amount, 0);

  const totalGroupIncome = incomes.reduce((s: number, i: any) => s + i.amount, 0);

  const memberStats = group.members.map((member: any) => {
    const income = incomes.find((i: any) => i.userId === member.userId)?.amount ?? null;

    const expensePaid = expenses
      .filter((e: any) => e.userId === member.userId)
      .reduce((sum: number, e: any) => {
        if (e.totalInstallments && e.totalInstallments > 1) {
          const active = e.installments.find(
            (inst: any) => inst.dueDate >= startOfMonth && inst.dueDate < startOfNextMonth
          );
          return sum + (active?.amount ?? e.amount);
        }
        return sum + e.amount;
      }, 0);

    const recurringPaid = recurringPeriods
      .filter((r: any) => (r.payerId ?? r.recurringExpense.payer?.id ?? r.recurringExpense.userId) === member.userId)
      .reduce((sum: number, r: any) => sum + r.amount, 0);

    const totalPaid = expensePaid + recurringPaid;

    const expenseCharged = expenses
      .filter((e: any) => e.shares.some((s: any) => s.userId === member.userId))
      .reduce((sum: number, e: any) => {
        const share = e.shares.find((s: any) => s.userId === member.userId);
        if (!share) return sum;
        if (e.totalInstallments && e.totalInstallments > 1) {
          const active = e.installments.find(
            (inst: any) => inst.dueDate >= startOfMonth && inst.dueDate < startOfNextMonth
          );
          const instAmount = active?.amount ?? e.amount;
          return sum + (instAmount * share.percentage) / 100;
        }
        return sum + share.amount;
      }, 0);

    const recurringCharged = recurringPeriods
      .flatMap((r: any) => r.shares)
      .filter((s: any) => s.userId === member.userId)
      .reduce((sum: number, s: any) => sum + s.amount, 0);

    const totalCharged = expenseCharged + recurringCharged;
    const idealPercentage = totalGroupIncome > 0 && income !== null ? (income / totalGroupIncome) * 100 : member.percentage;
    const idealToPay = (totalGroupExpenses * idealPercentage) / 100;
    const difference = totalPaid - idealToPay;
    const remainingIncome = income !== null ? income - totalPaid : null;

    return {
      userId: member.userId,
      name: member.user.name,
      percentage: member.percentage,
      income,
      totalPaid,
      totalCharged,
      netBalance: totalPaid - totalCharged,
      idealPercentage,
      idealToPay,
      difference,
      remainingIncome,
    };
  });

  const recurring = recurringPeriods.map((period: any) => ({
    id: period.id,
    amount: period.amount,
    description: period.description,
    frequency: period.recurringExpense.frequency,
    payer: period.payer ?? period.recurringExpense.payer ?? period.recurringExpense.user,
    user: period.recurringExpense.user,
    category: recurringCategoryMap.get(period.categoryId) ?? period.recurringExpense.category,
    nextDue: period.periodStart,
  }));

  return NextResponse.json({ group, expenses, recurring, memberStats, month, year, totalGroupExpenses });
}
