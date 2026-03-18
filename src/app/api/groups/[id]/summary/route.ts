import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const startOfMonth = new Date(year, month - 1, 1);
  const startOfNextMonth = new Date(year, month, 1);

  const [expenses, recurring, incomes] = await Promise.all([
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
    prisma.recurringExpense.findMany({
      where: { groupId: id, isShared: true },
      include: {
        category: { select: { id: true, name: true, color: true } },
        shares: { include: { user: { select: { id: true, name: true } } } },
        payer: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { nextDue: "asc" },
    }),
    prisma.monthlyIncome.findMany({
      where: {
        userId: { in: group.members.map((m: any) => m.userId) },
        month,
        year,
      },
    }),
  ]);

  const totalGroupExpenses =
    expenses.reduce((sum: number, e: any) => {
      if (e.totalInstallments && e.totalInstallments > 1) {
        const active = e.installments.find(
          (inst: any) => inst.dueDate >= startOfMonth && inst.dueDate < startOfNextMonth
        );
        return sum + (active?.amount ?? e.amount);
      }
      return sum + e.amount;
    }, 0) + recurring.reduce((sum: number, r: any) => sum + r.amount, 0);

  const totalGroupIncome = incomes.reduce((s: number, i: any) => s + i.amount, 0);

  const memberStats = group.members.map((member: any) => {
    const income = incomes.find((i: any) => i.userId === member.userId)?.amount ?? null;

    // Total paid = sum of expenses where this member is the payer
    // For installment expenses, use the monthly installment amount
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

    // + sum of recurring where this member is the payer (full amount)
    const recurringPaid = recurring
      .filter((r: any) => (r.payerId ?? r.userId) === member.userId)
      .reduce((sum: number, r: any) => sum + r.amount, 0);

    const totalPaid = expensePaid + recurringPaid;

    // Total charged = sum of expense shares for this member
    // For installment expenses, recalculate based on monthly installment amount
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

    // + sum of recurring shares for this member
    const recurringCharged = recurring
      .flatMap((r: any) => r.shares)
      .filter((s: any) => s.userId === member.userId)
      .reduce((sum: number, s: any) => sum + s.amount, 0);

    const totalCharged = expenseCharged + recurringCharged;

    const idealPercentage =
      totalGroupIncome > 0 && income !== null
        ? (income / totalGroupIncome) * 100
        : member.percentage;
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

  return NextResponse.json({ group, expenses, recurring, memberStats, month, year, totalGroupExpenses });
}
