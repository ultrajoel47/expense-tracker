import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureRecurringPeriodsForMonth, getNextPeriodMonthStart } from "@/lib/recurring-periods";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const group = await prisma.group.findFirst({
    where: {
      id,
      OR: [{ ownerId: session.id }, { members: { some: { userId: session.id } } }],
    },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
    },
  });
  if (!group) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });

  const userNames = new Map<string, string>(group.members.map((m: any) => [m.userId, m.user.name]));
  if (!userNames.has(group.ownerId)) {
    const owner = await prisma.user.findUnique({ where: { id: group.ownerId }, select: { name: true } });
    if (owner) userNames.set(group.ownerId, owner.name);
  }

  const now = new Date();
  await ensureRecurringPeriodsForMonth(prisma as any, { year: now.getFullYear(), month: now.getMonth() + 1, groupId: id });

  const [expenses, recurringPeriods] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId: id, isShared: true },
      include: { shares: true, installments: { select: { dueDate: true } } },
    }),
    prisma.recurringExpensePeriod.findMany({
      where: {
        recurringExpense: { groupId: id, isShared: true },
        periodStart: { lt: getNextPeriodMonthStart(now.getFullYear(), now.getMonth() + 1) },
      },
      include: { shares: true, recurringExpense: { select: { userId: true } } },
    }),
  ]);

  const ledger: Record<string, Record<string, number>> = {};
  for (const expense of expenses) {
    const creditorId = expense.userId;
    for (const share of expense.shares) {
      const debtorId = share.userId;
      if (!ledger[debtorId]) ledger[debtorId] = {};
      let amount = share.amount;
      if (expense.totalInstallments && expense.totalInstallments > 1) {
        const pastCount = expense.installments.filter((inst: any) => inst.dueDate <= now).length;
        amount = pastCount > 0 ? (share.amount / expense.totalInstallments) * pastCount : 0;
      }
      ledger[debtorId][creditorId] = (ledger[debtorId][creditorId] ?? 0) + amount;
    }
  }

  for (const period of recurringPeriods) {
    const creditorId = period.payerId ?? period.recurringExpense.userId;
    for (const share of period.shares) {
      const debtorId = share.userId;
      if (!ledger[debtorId]) ledger[debtorId] = {};
      ledger[debtorId][creditorId] = (ledger[debtorId][creditorId] ?? 0) + share.amount;
    }
  }

  const result: { debtorId: string; debtorName: string; creditorId: string; creditorName: string; amount: number }[] = [];
  const processedPairs = new Set<string>();

  for (const [debtorId, creditors] of Object.entries(ledger)) {
    for (const [creditorId, amount] of Object.entries(creditors)) {
      const pairKey = [debtorId, creditorId].sort().join("|");
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      const reverseAmount = ledger[creditorId]?.[debtorId] ?? 0;
      const netAmount = amount - reverseAmount;

      if (netAmount > 0.01) {
        result.push({ debtorId, debtorName: userNames.get(debtorId) ?? debtorId, creditorId, creditorName: userNames.get(creditorId) ?? creditorId, amount: netAmount });
      } else if (netAmount < -0.01) {
        result.push({ debtorId: creditorId, debtorName: userNames.get(creditorId) ?? creditorId, creditorId: debtorId, creditorName: userNames.get(debtorId) ?? debtorId, amount: -netAmount });
      }
    }
  }

  return NextResponse.json(result);
}
