import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const card = await prisma.creditCard.findFirst({ where: { id, userId: session.id } });
  if (!card) return NextResponse.json({ error: "Tarjeta no encontrada" }, { status: 404 });

  const pending = await prisma.installment.findMany({
    where: {
      paid: false,
      expense: { creditCardId: id, userId: session.id },
    },
    include: {
      expense: { select: { description: true, date: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  const totalPending = pending.reduce((s, i) => s + i.amount, 0);

  return NextResponse.json({ card, pending, totalPending });
}
