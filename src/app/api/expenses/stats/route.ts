import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { visibleExpensesWhere, visibleRecurringExpensesWhere } from "@/lib/visibility";
import { getHouseholdUserIds } from "@/lib/household";
import { expensesToCharges } from "@/lib/expenses/charges";
import { materializeRecurringForMonthSafely } from "@/lib/recurring-materialize";
import { parsePeriodParams } from "@/lib/period-params";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const url = new URL(req.url);

  // Validar ANTES de materializar: estos dos numeros alimentan una ESCRITURA.
  // Ver el comentario equivalente en `src/app/api/expenses/route.ts`.
  const parsed = parsePeriodParams(url.searchParams.get("month"), url.searchParams.get("year"));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { year, month } = parsed;

  const householdUserIds = await getHouseholdUserIds();

  // Perezoso: al leer un mes se crean los recurrentes que falten. Sin cron,
  // porque el free tier de Vercel los limita y el VPS usaria otro mecanismo.
  // El modulo acota el rango de meses materializables; ver
  // PRIMER_PERIODO_MATERIALIZABLE.
  // La materializacion NO puede tumbar la lectura. Es idempotente y se
  // reintenta en el request siguiente, asi que ante un fallo transitorio
  // (failover del replica set, corte de conexion, P2028 por timeout de
  // transaccion en un cold start de Vercel: son 10 transacciones seguidas por
  // cada carga) un 500 no arregla nada y se lleva la pagina puesta. El modulo
  // relanza a proposito todo lo que no sea P2002 — a SU nivel confundir un
  // fallo transitorio con "ya existe" haria que el alquiler dejara de aparecer
  // en silencio — pero a nivel de la ruta la balanza se invierte: se sirve la
  // lectura con lo que ya este materializado y el proximo request lo cura.
  //
  // `recurringMaterializationFailed` en la respuesta es lo que evita que ese
  // "se sirve igual" sea un silencio total: si fallo, el dashboard lo tiene
  // que poder mostrar en vez de que la unica traza quede en el log del server.
  const { fallo: recurringMaterializationFailed } = await materializeRecurringForMonthSafely(
    prisma as never,
    year,
    month,
    (error) => console.error("[stats] fallo la materializacion de recurrentes, se sirve la lectura igual", error)
  );

  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));

  // Previous month for comparison
  const prevStart = new Date(Date.UTC(year, month - 2, 1));
  const prevEnd = new Date(Date.UTC(year, month - 1, 1));

  const visibles = { ...visibleExpensesWhere(session.id, householdUserIds) };

  // Sin filtro de fecha a proposito: una compra de hace un año puede tener una
  // cuota que vence este mes. El recorte por rango lo hace expensesToCharges.
  const todos = await prisma.expense.findMany({
    where: visibles,
    include: { category: true, installments: { select: { dueDate: true, amount: true } } },
    orderBy: { date: "desc" },
  });

  const cargos = expensesToCharges(todos, startDate, endDate);
  const cargosPrev = expensesToCharges(todos, prevStart, prevEnd);

  const total = cargos.reduce((s, c) => s + c.amount, 0);
  const prevTotal = cargosPrev.reduce((s, c) => s + c.amount, 0);

  const byCategory = cargos.reduce(
    (acc: Record<string, { name: string; color: string; total: number; count: number }>, c) => {
      if (!acc[c.categoryName]) {
        acc[c.categoryName] = { name: c.categoryName, color: c.categoryColor, total: 0, count: 0 };
      }
      acc[c.categoryName].total += c.amount;
      acc[c.categoryName].count += 1;
      return acc;
    },
    {}
  );

  // Daily totals - fill all days of the month
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const maxDay = (year === today.getFullYear() && month === today.getMonth() + 1)
    ? today.getDate()
    : daysInMonth;

  const dailyMap = cargos.reduce((acc: Record<string, number>, c) => {
    const day = c.date.toISOString().split("T")[0];
    acc[day] = (acc[day] || 0) + c.amount;
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

  // Weekly totals (last 4 weeks), sobre cargos
  const weeklyTotals: { week: string; amount: number }[] = [];
  for (let w = 3; w >= 0; w--) {
    const wEnd = new Date(today);
    wEnd.setDate(today.getDate() - w * 7);
    const wStart = new Date(wEnd);
    wStart.setDate(wEnd.getDate() - 6);
    const weekAmount = cargos
      .filter((c) => { const d = new Date(c.date); return d >= wStart && d <= wEnd; })
      .reduce((s, c) => s + c.amount, 0);
    const label = `${wStart.getDate()}/${wStart.getMonth() + 1}-${wEnd.getDate()}/${wEnd.getMonth() + 1}`;
    weeklyTotals.push({ week: label, amount: weekAmount });
  }

  // recentExpenses y topExpense responden "que compramos", no "que pagamos":
  // por eso siguen filtrando por fecha de compra en vez de por cargos, a
  // diferencia del resto de este archivo.
  const expensesDelMes = todos.filter((e) => e.date >= startDate && e.date < endDate);

  // Recent expenses (last 10)
  const recentExpenses = expensesDelMes.slice(0, 10).map((e) => ({
    id: e.id,
    amount: e.amount,
    description: e.description,
    date: e.date.toISOString(),
    category: { name: e.category.name, color: e.category.color },
  }));

  // Top expense
  const topExpense = expensesDelMes.length
    ? expensesDelMes.reduce((max, e) => (e.amount > max.amount ? e : max))
    : null;

  // All-time recent (when current month is empty)
  let allTimeRecent: typeof recentExpenses = [];
  if (expensesDelMes.length === 0) {
    const latest = await prisma.expense.findMany({
      where: { ...visibleExpensesWhere(session.id, householdUserIds) },
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

  // Credit card pending totals
  const creditCardDebt = await prisma.installment.groupBy({
    by: ["expenseId"],
    where: {
      paid: false,
      expense: { ...visibleExpensesWhere(session.id, householdUserIds), creditCardId: { not: null } },
    },
    _sum: { amount: true },
  });
  const totalCreditCardDebt = creditCardDebt.reduce((s: number, r: any) => s + (r._sum.amount ?? 0), 0);

  // Upcoming recurring expenses (next 30 days)
  const in30Days = new Date(today);
  in30Days.setDate(in30Days.getDate() + 30);
  const upcomingRecurring = await prisma.recurringExpense.findMany({
    where: {
      ...visibleRecurringExpensesWhere(session.id, householdUserIds),
      active: true,
      nextDue: { lte: in30Days },
    },
    include: { category: { select: { name: true, color: true } } },
    orderBy: { nextDue: "asc" },
    take: 5,
  });

  // Tendencia: los 12 meses que terminan en el mes consultado, en cargos.
  const trend12m: { month: string; total: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const desde = new Date(Date.UTC(year, month - 1 - i, 1));
    const hasta = new Date(Date.UTC(year, month - i, 1));
    const delMes = expensesToCharges(todos, desde, hasta);
    trend12m.push({
      month: desde.toISOString().slice(0, 7),
      total: delMes.reduce((s, c) => s + c.amount, 0),
    });
  }

  return NextResponse.json({
    total,
    prevTotal,
    count: cargos.length,
    byCategory: Object.values(byCategory).sort((a: any, b: any) => b.total - a.total),
    dailyTotals,
    weeklyTotals,
    recentExpenses,
    topExpense: topExpense
      ? { amount: topExpense.amount, description: topExpense.description, category: topExpense.category.name }
      : null,
    allTimeRecent,
    totalCreditCardDebt,
    trend12m,
    upcomingRecurring: upcomingRecurring.map((r: any) => ({
      id: r.id,
      description: r.description,
      amount: r.amount,
      nextDue: r.nextDue.toISOString(),
      category: r.category,
    })),
    recurringMaterializationFailed,
  });
}
