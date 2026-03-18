import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface ShareDetail {
  id: string;
  userId: string;
  percentage: number;
  amount: number;
  user: { id: string; name: string };
}

interface CombinedEntry {
  id: string;
  type: "expense" | "recurring";
  role: "payer" | "debtor";
  date: string;
  description: string;
  totalAmount: number;
  myAmount: number;
  myPercentage: number | null;
  category: { id: string; name: string; color: string };
  payerName: string;
  payerId: string;
  shares: ShareDetail[];
  groupId: string | null;
  frequency?: string;
  nextDue?: string;
  installmentNumber?: number;
  totalInstallments?: number | null;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));
  const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));
  const dayParam = searchParams.get("day");
  const day = dayParam ? parseInt(dayParam) : null;
  const groupId = searchParams.get("groupId") || null;
  const categoryId = searchParams.get("categoryId") || null;
  const type = (searchParams.get("type") || "all") as "all" | "expense" | "recurring";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") ?? "15")));

  // Date range for the selected month (or single day)
  const startDate = day
    ? new Date(Date.UTC(year, month - 1, day))
    : new Date(Date.UTC(year, month - 1, 1));
  const endDate = day
    ? new Date(Date.UTC(year, month - 1, day + 1))
    : new Date(Date.UTC(year, month, 1));

  const groupFilter = groupId ? { groupId } : {};
  const categoryFilter = categoryId ? { categoryId } : {};

  const combined: CombinedEntry[] = [];

  // ─── One-time expenses ───────────────────────────────────────────────────
  if (type !== "recurring") {
    const [debtorShares, payerExpenses] = await Promise.all([
      // A: I have a share in someone else's expense (I owe them)
      prisma.expenseShare.findMany({
        where: {
          userId: session.id,
          expense: {
            ...groupFilter,
            ...categoryFilter,
            OR: [
              { totalInstallments: null, date: { gte: startDate, lt: endDate } },
              { totalInstallments: { lte: 1 }, date: { gte: startDate, lt: endDate } },
              { totalInstallments: { gt: 1 }, installments: { some: { dueDate: { gte: startDate, lt: endDate } } } },
            ],
          },
        },
        include: {
          expense: {
            include: {
              category: { select: { id: true, name: true, color: true } },
              shares: { include: { user: { select: { id: true, name: true } } } },
              user: { select: { id: true, name: true } },
              installments: { orderBy: { installmentNumber: "asc" } },
            },
          },
        },
      }),
      // B: I paid a shared expense (others owe me)
      prisma.expense.findMany({
        where: {
          userId: session.id,
          isShared: true,
          ...groupFilter,
          ...categoryFilter,
          OR: [
            { totalInstallments: null, date: { gte: startDate, lt: endDate } },
            { totalInstallments: { lte: 1 }, date: { gte: startDate, lt: endDate } },
            { totalInstallments: { gt: 1 }, installments: { some: { dueDate: { gte: startDate, lt: endDate } } } },
          ],
        },
        include: {
          category: { select: { id: true, name: true, color: true } },
          shares: { include: { user: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
          installments: { orderBy: { installmentNumber: "asc" } },
        },
      }),
    ]);

    for (const s of debtorShares) {
      const exp = s.expense;
      const isInstallment = exp.totalInstallments && exp.totalInstallments > 1;
      const activeInstallment = isInstallment
        ? exp.installments.find((inst: any) => inst.dueDate >= startDate && inst.dueDate < endDate)
        : null;
      const monthlyAmount = activeInstallment?.amount ?? exp.amount;
      const myAmount = isInstallment ? (monthlyAmount * s.percentage) / 100 : s.amount;
      combined.push({
        id: `es-${s.id}`,
        type: "expense",
        role: "debtor",
        date: activeInstallment ? activeInstallment.dueDate.toISOString() : exp.date.toISOString(),
        description: exp.description,
        totalAmount: monthlyAmount,
        myAmount,
        myPercentage: s.percentage,
        category: exp.category,
        payerName: exp.user.name,
        payerId: exp.userId,
        shares: exp.shares.map((sh: any) => ({
          id: sh.id,
          userId: sh.userId,
          percentage: sh.percentage,
          amount: isInstallment ? (monthlyAmount * sh.percentage) / 100 : sh.amount,
          user: sh.user,
        })),
        groupId: exp.groupId ?? null,
        installmentNumber: activeInstallment?.installmentNumber,
        totalInstallments: exp.totalInstallments,
      });
    }

    for (const exp of payerExpenses) {
      const isInstallment = exp.totalInstallments && exp.totalInstallments > 1;
      const activeInstallment = isInstallment
        ? exp.installments.find((inst: any) => inst.dueDate >= startDate && inst.dueDate < endDate)
        : null;
      const monthlyAmount = activeInstallment?.amount ?? exp.amount;
      const othersAmount = isInstallment
        ? exp.shares.reduce((s: number, sh: any) => s + (monthlyAmount * sh.percentage) / 100, 0)
        : exp.shares.reduce((s: number, sh: any) => s + sh.amount, 0);
      combined.push({
        id: `ep-${exp.id}`,
        type: "expense",
        role: "payer",
        date: activeInstallment ? activeInstallment.dueDate.toISOString() : exp.date.toISOString(),
        description: exp.description,
        totalAmount: monthlyAmount,
        myAmount: othersAmount,
        myPercentage: null,
        category: exp.category,
        payerName: exp.user.name,
        payerId: exp.userId,
        shares: exp.shares.map((sh: any) => ({
          id: sh.id,
          userId: sh.userId,
          percentage: sh.percentage,
          amount: isInstallment ? (monthlyAmount * sh.percentage) / 100 : sh.amount,
          user: sh.user,
        })),
        groupId: exp.groupId ?? null,
        installmentNumber: activeInstallment?.installmentNumber,
        totalInstallments: exp.totalInstallments,
      });
    }
  }

  // ─── Recurring expenses ──────────────────────────────────────────────────
  if (type !== "expense") {
    const [debtorShares, payerRecurring] = await Promise.all([
      // C: I have a share in someone's recurring (I owe them)
      prisma.recurringShare.findMany({
        where: {
          userId: session.id,
          recurringExpense: {
            ...groupFilter,
            ...categoryFilter,
            nextDue: { gte: startDate, lt: endDate },
          },
        },
        include: {
          recurringExpense: {
            include: {
              category: { select: { id: true, name: true, color: true } },
              shares: { include: { user: { select: { id: true, name: true } } } },
              user: { select: { id: true, name: true } },
              payer: { select: { id: true, name: true } },
            },
          },
        },
      }),
      // D: I am the effective payer of a shared recurring (others owe me)
      prisma.recurringExpense.findMany({
        where: {
          OR: [
            { payerId: session.id },
            { userId: session.id, payerId: null },
          ],
          isShared: true,
          ...groupFilter,
          ...categoryFilter,
          nextDue: { gte: startDate, lt: endDate },
        },
        include: {
          category: { select: { id: true, name: true, color: true } },
          shares: { include: { user: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
          payer: { select: { id: true, name: true } },
        },
      }),
    ]);

    const seen = new Set<string>();

    for (const s of debtorShares) {
      const rec = s.recurringExpense;
      seen.add(rec.id);
      const effectivePayerName = rec.payer?.name ?? rec.user.name;
      const effectivePayerId = rec.payerId ?? rec.userId;
      combined.push({
        id: `rs-${s.id}`,
        type: "recurring",
        role: "debtor",
        date: rec.nextDue.toISOString(),
        description: rec.description,
        totalAmount: rec.amount,
        myAmount: s.amount,
        myPercentage: s.percentage,
        category: rec.category,
        payerName: effectivePayerName,
        payerId: effectivePayerId,
        shares: rec.shares.map((sh: any) => ({
          id: sh.id,
          userId: sh.userId,
          percentage: sh.percentage,
          amount: sh.amount,
          user: sh.user,
        })),
        groupId: rec.groupId ?? null,
        frequency: rec.frequency,
        nextDue: rec.nextDue.toISOString(),
      });
    }

    for (const rec of payerRecurring) {
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);
      const effectivePayerName = rec.payer?.name ?? rec.user.name;
      const effectivePayerId = rec.payerId ?? rec.userId;
      const othersAmount = rec.shares.reduce((s: number, sh: any) => s + sh.amount, 0);
      combined.push({
        id: `rp-${rec.id}`,
        type: "recurring",
        role: "payer",
        date: rec.nextDue.toISOString(),
        description: rec.description,
        totalAmount: rec.amount,
        myAmount: othersAmount,
        myPercentage: null,
        category: rec.category,
        payerName: effectivePayerName,
        payerId: effectivePayerId,
        shares: rec.shares.map((sh: any) => ({
          id: sh.id,
          userId: sh.userId,
          percentage: sh.percentage,
          amount: sh.amount,
          user: sh.user,
        })),
        groupId: rec.groupId ?? null,
        frequency: rec.frequency,
        nextDue: rec.nextDue.toISOString(),
      });
    }
  }

  // Sort by date descending
  combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Monthly summary from full (pre-paginated) list
  const summary = {
    totalShared: combined.reduce((s, e) => s + e.totalAmount, 0),
    myShare: combined.filter((e) => e.role === "debtor").reduce((s, e) => s + e.myAmount, 0),
    othersShare: combined.filter((e) => e.role === "payer").reduce((s, e) => s + e.myAmount, 0),
  };

  // Pagination
  const total = combined.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const items = combined.slice((safePage - 1) * limit, safePage * limit);

  return NextResponse.json({
    items,
    pagination: { total, page: safePage, totalPages, limit },
    summary,
  });
}
