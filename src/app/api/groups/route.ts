import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const groups = await prisma.group.findMany({
    where: {
      OR: [
        { ownerId: session.id },
        { members: { some: { userId: session.id } } },
      ],
    },
    include: {
      members: {
        include: { user: { select: { id: true, name: true } } },
      },
      owner: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(groups);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json();
  const { name, members = [] } = body;

  if (!name) {
    return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
  }

  const membersList: { userId: string; percentage: number }[] = Array.isArray(members) ? [...members] : [];

  // Ensure owner is included
  const ownerInMembers = membersList.some((m) => m.userId === session.id);
  if (!ownerInMembers) {
    membersList.push({ userId: session.id, percentage: 0 });
  }

  // Validate percentages sum to ~100%
  const total = membersList.reduce((s, m) => s + (Number(m.percentage) || 0), 0);
  if (Math.abs(total - 100) > 1) {
    return NextResponse.json({ error: "Los porcentajes deben sumar 100%" }, { status: 400 });
  }

  const group = await prisma.group.create({
    data: {
      name,
      ownerId: session.id,
      members: {
        create: membersList.map((m) => ({
          userId: m.userId,
          percentage: Number(m.percentage),
        })),
      },
    },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      owner: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(group, { status: 201 });
}
