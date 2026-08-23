import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { visibleRecurringExpensesWhere } from "@/lib/visibility";
import { getHouseholdUserIds } from "@/lib/household";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const householdUserIds = await getHouseholdUserIds();

  const { id } = await params;
  const rec = await prisma.recurringExpense.findFirst({
    where: { id, ...visibleRecurringExpensesWhere(session.id, householdUserIds) },
  });
  if (!rec) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json();

  const updated = await prisma.recurringExpense.update({
    where: { id },
    data: {
      amount: body.amount ? Number(body.amount) : undefined,
      description: body.description || undefined,
      categoryId: body.categoryId || undefined,
      creditCardId: body.creditCardId !== undefined ? body.creditCardId || null : undefined,
      frequency: body.frequency || undefined,
      dayOfMonth: body.dayOfMonth !== undefined ? Number(body.dayOfMonth) || null : undefined,
      nextDue: body.nextDue ? new Date(body.nextDue) : undefined,
      active: body.active !== undefined ? Boolean(body.active) : undefined,
    },
    include: {
      category: { select: { id: true, name: true, color: true } },
      creditCard: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const householdUserIds = await getHouseholdUserIds();

  const { id } = await params;
  const rec = await prisma.recurringExpense.findFirst({
    where: { id, ...visibleRecurringExpensesWhere(session.id, householdUserIds) },
  });
  if (!rec) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  await prisma.recurringExpense.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
