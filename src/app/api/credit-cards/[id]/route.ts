import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const card = await prisma.creditCard.findFirst({ where: { id, userId: session.id } });
  if (!card) return NextResponse.json({ error: "Tarjeta no encontrada" }, { status: 404 });

  const body = await req.json();
  const updated = await prisma.creditCard.update({
    where: { id },
    data: {
      name: body.name || undefined,
      lastFour: body.lastFour !== undefined ? body.lastFour || null : undefined,
      color: body.color || undefined,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const card = await prisma.creditCard.findFirst({ where: { id, userId: session.id } });
  if (!card) return NextResponse.json({ error: "Tarjeta no encontrada" }, { status: 404 });

  await prisma.creditCard.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
