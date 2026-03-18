import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { name, icon, color } = await req.json();

  try {
    const category = await prisma.category.update({
      where: { id },
      data: { name, icon, color },
    });
    return NextResponse.json(category);
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar la categoria" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const expenses = await prisma.expense.count({ where: { categoryId: id } });
  if (expenses > 0) {
    return NextResponse.json(
      { error: "No se puede eliminar: tiene gastos asociados" },
      { status: 400 }
    );
  }

  const budgets = await prisma.budget.count({ where: { categoryId: id } });
  if (budgets > 0) {
    return NextResponse.json(
      { error: "No se puede eliminar: tiene presupuestos asociados" },
      { status: 400 }
    );
  }

  await prisma.category.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
