import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const group = await prisma.group.findFirst({
    where: {
      id,
      OR: [{ ownerId: session.id }, { members: { some: { userId: session.id } } }],
    },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      owner: { select: { id: true, name: true } },
    },
  });

  if (!group) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
  return NextResponse.json(group);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const group = await prisma.group.findFirst({ where: { id, ownerId: session.id } });
  if (!group) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });

  const { name } = await req.json();
  const updated = await prisma.group.update({
    where: { id },
    data: { name: name || undefined },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      owner: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const group = await prisma.group.findFirst({ where: { id, ownerId: session.id } });
  if (!group) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });

  // Disassociate expenses and recurring expenses
  await prisma.expense.updateMany({ where: { groupId: id }, data: { groupId: null } });
  await prisma.recurringExpense.updateMany({ where: { groupId: id }, data: { groupId: null } });

  // Delete members then group
  await prisma.groupMember.deleteMany({ where: { groupId: id } });
  await prisma.group.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
