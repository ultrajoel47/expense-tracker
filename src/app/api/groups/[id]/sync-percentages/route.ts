import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;

  const group = await prisma.group.findFirst({
    where: { id, ownerId: session.id },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
    },
  });

  if (!group) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });

  const memberCount = group.members.length;
  if (memberCount === 0) {
    return NextResponse.json({ error: "El grupo no tiene miembros" }, { status: 400 });
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const memberIds = group.members.map((m: any) => m.userId);

  const incomes = await prisma.monthlyIncome.findMany({
    where: { userId: { in: memberIds }, month: currentMonth, year: currentYear },
  });

  const incomeMap = new Map<string, number>(incomes.map((i: any) => [i.userId, i.amount]));

  const warnings: string[] = [];
  for (const member of group.members) {
    if (!incomeMap.has(member.userId)) {
      warnings.push(member.user.name);
    }
  }

  const totalIncome = incomes.reduce((sum: number, i: any) => sum + i.amount, 0);

  // Calculate percentages
  let percentages: { userId: string; percentage: number }[];

  if (totalIncome === 0) {
    // Equal split
    const base = parseFloat((100 / memberCount).toFixed(4));
    percentages = group.members.map((m: any, idx: number) => ({
      userId: m.userId,
      percentage: idx === memberCount - 1 ? parseFloat((100 - base * (memberCount - 1)).toFixed(4)) : base,
    }));
  } else {
    // Proportional to income
    const rawPercentages = group.members.map((m: any) => ({
      userId: m.userId,
      percentage: parseFloat((((incomeMap.get(m.userId) ?? 0) / totalIncome) * 100).toFixed(4)),
    }));

    // Adjust last member so total is exactly 100
    const sumWithoutLast = rawPercentages.slice(0, -1).reduce((s: number, p: any) => s + p.percentage, 0);
    rawPercentages[rawPercentages.length - 1].percentage = parseFloat(
      (100 - sumWithoutLast).toFixed(4)
    );
    percentages = rawPercentages;
  }

  // Replace all members with updated percentages
  await prisma.$transaction([
    prisma.groupMember.deleteMany({ where: { groupId: id } }),
    prisma.groupMember.createMany({
      data: percentages.map((p) => ({ groupId: id, userId: p.userId, percentage: p.percentage })),
    }),
  ]);

  const updated = await prisma.group.findFirst({
    where: { id },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      owner: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ members: updated?.members ?? [], warnings });
}
