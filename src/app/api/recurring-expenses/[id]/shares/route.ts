import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;

  const shares = await prisma.recurringShare.findMany({
    where: { recurringExpenseId: id },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return NextResponse.json(shares);
}

