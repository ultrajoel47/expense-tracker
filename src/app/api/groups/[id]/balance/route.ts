import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  // Build name lookup from group members
  const userNames = new Map<string, string>(group.members.map((m) => [m.userId, m.user.name]));
  // Also include owner name
  if (!userNames.has(group.ownerId)) {
    const owner = await prisma.user.findUnique({ where: { id: group.ownerId }, select: { name: true } });
    if (owner) userNames.set(group.ownerId, owner.name);
  }

  // Get all shared expenses for this group with their shares
  const expenses = await prisma.expense.findMany({
    where: { groupId: id, isShared: true },
    include: { shares: true },
  });

  // Get recurring expenses for this group with their shares
  const recurringExpenses = await prisma.recurringExpense.findMany({
    where: { groupId: id, isShared: true },
    include: { shares: true },
  });

  // Build ledger: ledger[debtorId][creditorId] += amount
  const ledger: Record<string, Record<string, number>> = {};
  for (const expense of expenses) {
    const creditorId = expense.userId; // payer = creditor
    for (const share of expense.shares) {
      const debtorId = share.userId;
      if (!ledger[debtorId]) ledger[debtorId] = {};
      ledger[debtorId][creditorId] = (ledger[debtorId][creditorId] ?? 0) + share.amount;
    }
  }
  for (const rec of recurringExpenses) {
    const creditorId = rec.payerId ?? rec.userId;
    for (const share of rec.shares) {
      const debtorId = share.userId;
      if (!ledger[debtorId]) ledger[debtorId] = {};
      ledger[debtorId][creditorId] = (ledger[debtorId][creditorId] ?? 0) + share.amount;
    }
  }

  // Simplify net debts — process each pair once
  const result: {
    debtorId: string;
    debtorName: string;
    creditorId: string;
    creditorName: string;
    amount: number;
  }[] = [];
  const processedPairs = new Set<string>();

  for (const [debtorId, creditors] of Object.entries(ledger)) {
    for (const [creditorId, amount] of Object.entries(creditors)) {
      const pairKey = [debtorId, creditorId].sort().join("|");
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      const reverseAmount = ledger[creditorId]?.[debtorId] ?? 0;
      const netAmount = amount - reverseAmount;

      if (netAmount > 0.01) {
        result.push({
          debtorId,
          debtorName: userNames.get(debtorId) ?? debtorId,
          creditorId,
          creditorName: userNames.get(creditorId) ?? creditorId,
          amount: netAmount,
        });
      } else if (netAmount < -0.01) {
        result.push({
          debtorId: creditorId,
          debtorName: userNames.get(creditorId) ?? creditorId,
          creditorId: debtorId,
          creditorName: userNames.get(debtorId) ?? debtorId,
          amount: -netAmount,
        });
      }
    }
  }

  return NextResponse.json(result);
}
