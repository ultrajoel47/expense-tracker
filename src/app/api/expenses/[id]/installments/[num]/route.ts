import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(_req: Request, { params }: { params: Promise<{ id: string; num: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id, num } = await params;
  const installmentNumber = Number(num);

  const expense = await prisma.expense.findFirst({ where: { id, userId: session.id } });
  if (!expense) return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });

  const installment = await prisma.installment.findUnique({
    where: { expenseId_installmentNumber: { expenseId: id, installmentNumber } },
  });
  if (!installment) return NextResponse.json({ error: "Cuota no encontrada" }, { status: 404 });

  const updated = await prisma.installment.update({
    where: { expenseId_installmentNumber: { expenseId: id, installmentNumber } },
    data: {
      paid: !installment.paid,
      paidAt: installment.paid ? null : new Date(),
    },
  });

  return NextResponse.json(updated);
}
