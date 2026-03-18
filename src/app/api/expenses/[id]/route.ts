import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type ManualShare = { userId: string; percentage: number };

async function recreateExpenseShares(
  expenseId: string,
  totalAmount: number,
  splitMode: string,
  allUserIds: string[],
  manualShares: ManualShare[],
  payerId: string
) {
  await prisma.expenseShare.deleteMany({ where: { expenseId } });

  if (splitMode === "manual" && manualShares.length > 0) {
    const total = manualShares.reduce((s, u) => s + u.percentage, 0);
    if (Math.abs(total - 100) > 1) return;
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
      await prisma.expenseShare.createMany({
        data: nonPayerIds.map((uid) => {
          const userIncome = incomeMap.get(uid) ?? 0;
          const pct = (userIncome / totalIncome) * 100;
          return { expenseId, userId: uid, percentage: pct, amount: (totalAmount * pct) / 100 };
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

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;

  const expense = await prisma.expense.findFirst({ where: { id, userId: session.id } });
  if (!expense) return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });

  await prisma.installment.deleteMany({ where: { expenseId: id } });
  await prisma.expenseShare.deleteMany({ where: { expenseId: id } });
  await prisma.expense.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;

  const expense = await prisma.expense.findFirst({ where: { id, userId: session.id } });
  if (!expense) return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });

  const body = await req.json();
  const { isShared, splitMode = "auto", sharedUserIds, sharedUsers } = body;

  const updated = await prisma.expense.update({
    where: { id },
    data: {
      amount: body.amount ? Number(body.amount) : undefined,
      description: body.description || undefined,
      date: body.date ? new Date(body.date) : undefined,
      categoryId: body.categoryId || undefined,
      creditCardId: body.creditCardId !== undefined ? body.creditCardId || null : undefined,
      groupId: body.groupId !== undefined ? body.groupId || null : undefined,
      isShared: isShared !== undefined ? !!isShared : undefined,
      splitMode: isShared !== undefined ? splitMode : undefined,
    },
    include: { category: true },
  });

  const totalAmount = body.amount ? Number(body.amount) : expense.amount;

  if (isShared === false) {
    await prisma.expenseShare.deleteMany({ where: { expenseId: id } });
  } else if (isShared === true) {
    if (splitMode === "manual" && Array.isArray(sharedUsers) && sharedUsers.length > 0) {
      await recreateExpenseShares(id, totalAmount, "manual", [], sharedUsers, session.id);
    } else if (splitMode === "auto" && Array.isArray(sharedUserIds) && sharedUserIds.length > 0) {
      const allUserIds = [...new Set([session.id, ...sharedUserIds])];
      await recreateExpenseShares(id, totalAmount, "auto", allUserIds, [], session.id);
    }
  }

  return NextResponse.json(updated);
}
