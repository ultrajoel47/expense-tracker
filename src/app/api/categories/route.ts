import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isHouseholdMember } from "@/lib/household";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(categories);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!(await isHouseholdMember(session.id))) {
    return NextResponse.json({ error: "No habilitado" }, { status: 403 });
  }

  const { name, icon, color } = await req.json();

  if (!name || !name.trim()) {
    return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
  }

  try {
    const category = await prisma.category.create({
      data: { name: name.trim(), icon: icon || "tag", color: color || "#6366f1" },
    });
    return NextResponse.json(category, { status: 201 });
  } catch {
    return NextResponse.json({ error: "La categoria ya existe" }, { status: 400 });
  }
}
