import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { visibleExpensesWhere } from "@/lib/visibility";
import { getHouseholdUserIds } from "@/lib/household";
import { rebuildInstallments, requiereRebuildDeCuotas } from "@/lib/expenses/correct";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const householdUserIds = await getHouseholdUserIds();

  const { id } = await params;

  const expense = await prisma.expense.findFirst({
    where: { id, ...visibleExpensesWhere(session.id, householdUserIds) },
  });
  if (!expense) return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });

  await prisma.installment.deleteMany({ where: { expenseId: id } });
  await prisma.expense.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const householdUserIds = await getHouseholdUserIds();

  const { id } = await params;

  const expense = await prisma.expense.findFirst({
    where: { id, ...visibleExpensesWhere(session.id, householdUserIds) },
  });
  if (!expense) return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });

  const body = await req.json();

  const updated = await prisma.expense.update({
    where: { id },
    data: {
      amount: body.amount ? Number(body.amount) : undefined,
      description: body.description || undefined,
      date: body.date ? new Date(body.date) : undefined,
      categoryId: body.categoryId || undefined,
      creditCardId: body.creditCardId !== undefined ? body.creditCardId || null : undefined,
      // scope es reclasificable (casa <-> personal); userId/createdById/source
      // no se tocan aca: son identidad/procedencia, no se reasignan al editar.
      scope: body.scope === "personal" || body.scope === "casa" ? body.scope : undefined,
    },
    include: { category: true },
  });

  // Ver el comentario de cabecera de `rebuildInstallments`: sin esto, corregir
  // el monto de una compra en cuotas no cambia ningun total del dashboard,
  // porque los totales cuentan la cuota que vence, no el total del gasto.
  //
  // El criterio de "hay que reconstruir" vive en `requiereRebuildDeCuotas`
  // (unico, compartido con `applyCorrection` del bot): antes estaba escrito
  // dos veces, con criterios distintos, y la version del bot recalculaba de
  // mas comparando la fecha por `getTime()` en vez de por año/mes.
  if (
    expense.totalInstallments &&
    requiereRebuildDeCuotas(expense, { amount: updated.amount, date: updated.date })
  ) {
    await rebuildInstallments(prisma, id, updated.date, updated.amount, expense.totalInstallments);
  }

  return NextResponse.json(updated);
}
