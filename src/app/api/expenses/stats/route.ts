import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const url = new URL(req.url);
  const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
  const year = Number(url.searchParams.get("year") || new Date().getFullYear());

  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));

  // Current month expenses
  const expenses = await prisma.expense.findMany({
    where: {
      userId: session.id,
      date: { gte: startDate, lt: endDate },
    },
    include: { category: true },
    orderBy: { date: "desc" },
  });

  // Previous month for comparison
  const prevStart = new Date(Date.UTC(year, month - 2, 1));
  const prevEnd = new Date(Date.UTC(year, month - 1, 1));
  const prevExpenses = await prisma.expense.findMany({
    where: { userId: session.id, date: { gte: prevStart, lt: prevEnd } },
  });
  const prevTotal = prevExpenses.reduce((s: number, e: any) => s + e.amount, 0);

  const total = expenses.reduce((sum: number, e: any) => sum + e.amount, 0);

  const byCategory = expenses.reduce((acc: Record<string, { name: string; color: string; total: number; count: number }>, e: any) => {
    const key = e.category.name;
    if (!acc[key]) acc[key] = { name: key, color: e.category.color, total: 0, count: 0 };
    acc[key].total += e.amount;
    acc[key].count += 1;
    return acc;
  }, {});

  // Daily totals - fill all days of the month
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const maxDay = (year === today.getFullYear() && month === today.getMonth() + 1)
    ? today.getDate()
    : daysInMonth;

  const dailyMap = expenses.reduce((acc: Record<string, number>, e: any) => {
    const day = e.date.toISOString().split("T")[0];
    acc[day] = (acc[day] || 0) + e.amount;
    return acc;
  }, {});

  const dailyTotals: { date: string; amount: number; cumulative: number }[] = [];
  let cumulative = 0;
  for (let d = 1; d <= maxDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const amount = dailyMap[dateStr] || 0;
    cumulative += amount;
    dailyTotals.push({ date: dateStr, amount, cumulative });
  }

  // Weekly totals (last 4 weeks)
  const weeklyTotals: { week: string; amount: number }[] = [];
  for (let w = 3; w >= 0; w--) {
    const wEnd = new Date(today);
    wEnd.setDate(today.getDate() - w * 7);
    const wStart = new Date(wEnd);
    wStart.setDate(wEnd.getDate() - 6);
    const weekAmount = expenses
      .filter((e: any) => { const d = new Date(e.date); return d >= wStart && d <= wEnd; })
      .reduce((s: number, e: any) => s + e.amount, 0);
    const label = `${wStart.getDate()}/${wStart.getMonth() + 1}-${wEnd.getDate()}/${wEnd.getMonth() + 1}`;
    weeklyTotals.push({ week: label, amount: weekAmount });
  }

  // Budgets and alerts
  const budgets = await prisma.budget.findMany({
    where: { userId: session.id, month, year },
    include: { category: true },
  });

  const alerts = budgets
    .map((b: any) => {
      const spent = byCategory[b.category.name]?.total || 0;
      const pct = (spent / b.amount) * 100;
      return { category: b.category.name, budget: b.amount, spent, percentage: Math.round(pct) };
    })
    .filter((a: any) => a.percentage >= 80);

  // Recent expenses (last 10)
  const recentExpenses = expenses.slice(0, 10).map((e: any) => ({
    id: e.id,
    amount: e.amount,
    description: e.description,
    date: e.date.toISOString(),
    category: { name: e.category.name, color: e.category.color },
  }));

  // Top expense
  const topExpense = expenses.length
    ? expenses.reduce((max: any, e: any) => (e.amount > max.amount ? e : max))
    : null;

  // All-time recent (when current month is empty)
  let allTimeRecent: typeof recentExpenses = [];
  if (expenses.length === 0) {
    const latest = await prisma.expense.findMany({
      where: { userId: session.id },
      include: { category: true },
      orderBy: { date: "desc" },
      take: 10,
    });
    allTimeRecent = latest.map((e: any) => ({
      id: e.id,
      amount: e.amount,
      description: e.description,
      date: e.date.toISOString(),
      category: { name: e.category.name, color: e.category.color },
    }));
  }

  // Monthly income and spending percentage
  const monthlyIncome = await prisma.monthlyIncome.findFirst({
    where: { userId: session.id, month, year },
  });
  const incomeAmount = monthlyIncome?.amount ?? null;
  const spendingPercentage = incomeAmount && incomeAmount > 0
    ? Math.round((total / incomeAmount) * 100)
    : null;

  // Credit card pending totals
  const creditCardDebt = await prisma.installment.groupBy({
    by: ["expenseId"],
    where: {
      paid: false,
      expense: { userId: session.id, creditCardId: { not: null } },
    },
    _sum: { amount: true },
  });
  const totalCreditCardDebt = creditCardDebt.reduce((s: number, r: any) => s + (r._sum.amount ?? 0), 0);

  // Upcoming recurring expenses (next 30 days)
  const in30Days = new Date(today);
  in30Days.setDate(in30Days.getDate() + 30);
  const upcomingRecurring = await prisma.recurringExpense.findMany({
    where: {
      userId: session.id,
      active: true,
      nextDue: { lte: in30Days },
    },
    include: { category: { select: { name: true, color: true } } },
    orderBy: { nextDue: "asc" },
    take: 5,
  });

  return NextResponse.json({
    total,
    prevTotal,
    count: expenses.length,
    byCategory: Object.values(byCategory).sort((a: any, b: any) => b.total - a.total),
    dailyTotals,
    weeklyTotals,
    alerts,
    recentExpenses,
    topExpense: topExpense
      ? { amount: topExpense.amount, description: topExpense.description, category: topExpense.category.name }
      : null,
    allTimeRecent,
    incomeAmount,
    spendingPercentage,
    totalCreditCardDebt,
    upcomingRecurring: upcomingRecurring.map((r: any) => ({
      id: r.id,
      description: r.description,
      amount: r.amount,
      nextDue: r.nextDue.toISOString(),
      category: r.category,
    })),
  });
}
