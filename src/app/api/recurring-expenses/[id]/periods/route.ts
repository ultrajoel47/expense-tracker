import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const rec = await prisma.recurringExpense.findFirst({ where: { id, userId: session.id } });
  if (!rec) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const periods = await prisma.recurringExpensePeriod.findMany({
    where: { recurringExpenseId: id },
    include: {
      shares: { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: { periodStart: "desc" },
  });

  return NextResponse.json(periods);
}
