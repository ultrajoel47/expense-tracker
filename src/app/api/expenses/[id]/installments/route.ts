import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;

  const expense = await prisma.expense.findFirst({ where: { id, userId: session.id } });
  if (!expense) return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });

  const installments = await prisma.installment.findMany({
    where: { expenseId: id },
    orderBy: { installmentNumber: "asc" },
  });

  return NextResponse.json(installments);
}
