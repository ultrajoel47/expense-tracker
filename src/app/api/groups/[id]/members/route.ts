import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const group = await prisma.group.findFirst({
    where: { id, OR: [{ ownerId: session.id }, { members: { some: { userId: session.id } } }] },
  });
  if (!group) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });

  const members = await prisma.groupMember.findMany({
    where: { groupId: id },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return NextResponse.json(members);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const group = await prisma.group.findFirst({ where: { id, ownerId: session.id } });
  if (!group) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });

  const { userId, percentage } = await req.json();
  if (!userId || percentage === undefined) {
    return NextResponse.json({ error: "userId y percentage son requeridos" }, { status: 400 });
  }

  const existing = await prisma.groupMember.findMany({ where: { groupId: id } });
  const newTotal = existing.reduce((s: number, m: any) => s + m.percentage, 0) + Number(percentage);
  if (newTotal > 101) {
    return NextResponse.json({ error: "Los porcentajes superarían el 100%" }, { status: 400 });
  }

  const member = await prisma.groupMember.create({
    data: { groupId: id, userId, percentage: Number(percentage) },
    include: { user: { select: { id: true, name: true } } },
  });

  return NextResponse.json(member, { status: 201 });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const group = await prisma.group.findFirst({ where: { id, ownerId: session.id } });
  if (!group) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });

  const { members } = await req.json();
  if (!Array.isArray(members)) {
    return NextResponse.json({ error: "members debe ser un array" }, { status: 400 });
  }

  const total = members.reduce((s: number, m: { percentage: number }) => s + Number(m.percentage), 0);
  if (Math.abs(total - 100) > 1) {
    return NextResponse.json({ error: "Los porcentajes deben sumar 100%" }, { status: 400 });
  }

  await prisma.groupMember.deleteMany({ where: { groupId: id } });
  await prisma.groupMember.createMany({
    data: members.map((m: { userId: string; percentage: number }) => ({
      groupId: id,
      userId: m.userId,
      percentage: Number(m.percentage),
    })),
  });

  const updated = await prisma.groupMember.findMany({
    where: { groupId: id },
    include: { user: { select: { id: true, name: true } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const group = await prisma.group.findFirst({ where: { id, ownerId: session.id } });
  if (!group) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId requerido" }, { status: 400 });

  await prisma.groupMember.deleteMany({ where: { groupId: id, userId } });
  return NextResponse.json({ ok: true });
}
