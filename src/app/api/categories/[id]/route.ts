import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FALLBACK_CATEGORY } from "@/lib/ai/parse";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const { name, icon, color } = await req.json();

  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Categoria no encontrada" }, { status: 404 });

  // Renombrar la categoria de respaldo la rompe igual que borrarla: el bot
  // resuelve `FALLBACK_CATEGORY` por NOMBRE, asi que con la fila renombrada no
  // hay a donde caer cuando la IA devuelve una categoria que no existe. El
  // icono y el color si se pueden cambiar.
  if (existing.name === FALLBACK_CATEGORY && name && name !== FALLBACK_CATEGORY) {
    return NextResponse.json(
      { error: `No se puede renombrar "${FALLBACK_CATEGORY}": es la categoria de respaldo del bot` },
      { status: 400 }
    );
  }

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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;

  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Categoria no encontrada" }, { status: 404 });

  // Sin la categoria de respaldo, un mensaje al bot cuya categoria la IA no
  // acierta se queda sin destino: la resolucion falla y el usuario recibe un
  // error en vez de su gasto. Es borrable hoy porque el guard de abajo solo
  // mira los gastos, y una categoria puede quedar en cero.
  if (existing.name === FALLBACK_CATEGORY) {
    return NextResponse.json(
      { error: `No se puede eliminar "${FALLBACK_CATEGORY}": es la categoria de respaldo del bot` },
      { status: 400 }
    );
  }

  const expenses = await prisma.expense.count({ where: { categoryId: id } });
  if (expenses > 0) {
    return NextResponse.json(
      { error: "No se puede eliminar: tiene gastos asociados" },
      { status: 400 }
    );
  }

  await prisma.category.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
