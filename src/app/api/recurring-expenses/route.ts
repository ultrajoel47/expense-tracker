import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { visibleRecurringExpensesWhere } from "@/lib/visibility";
import { getHouseholdUserIds, isHouseholdMember } from "@/lib/household";
import { FRECUENCIAS_MATERIALIZABLES } from "@/lib/recurring-materialize";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const householdUserIds = await getHouseholdUserIds();

  const url = new URL(req.url);
  const categoryId = url.searchParams.get("categoryId");
  const activeParam = url.searchParams.get("active"); // "true" | "false" | null

  const where: Record<string, unknown> = { ...visibleRecurringExpensesWhere(session.id, householdUserIds) };
  if (categoryId) where.categoryId = categoryId;
  if (activeParam === "true") where.active = true;
  if (activeParam === "false") where.active = false;

  const recurring = await prisma.recurringExpense.findMany({
    where,
    include: {
      category: { select: { id: true, name: true, color: true } },
      creditCard: { select: { id: true, name: true } },
    },
    orderBy: { nextDue: "asc" },
  });

  return NextResponse.json(recurring);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!(await isHouseholdMember(session.id))) {
    return NextResponse.json({ error: "No habilitado" }, { status: 403 });
  }

  const body = await req.json();
  const { amount, description, categoryId, creditCardId, frequency, dayOfMonth, nextDue } = body;

  if (!amount || !description || !categoryId || !frequency || !nextDue) {
    return NextResponse.json(
      { error: "Campos requeridos: amount, description, categoryId, frequency, nextDue" },
      { status: 400 }
    );
  }

  // El materializador solo procesa FRECUENCIAS_MATERIALIZABLES ("MONTHLY" hoy).
  // Sin este chequeo una plantilla WEEKLY se crea, se lista y aparece en
  // "proximos recurrentes", pero no entra en ningun total: nunca se materializa.
  if (!(FRECUENCIAS_MATERIALIZABLES as readonly string[]).includes(frequency)) {
    return NextResponse.json(
      {
        error: `frequency debe ser una de: ${FRECUENCIAS_MATERIALIZABLES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const recurring = await prisma.recurringExpense.create({
    data: {
      userId: session.id,
      amount: Number(amount),
      description,
      categoryId,
      creditCardId: creditCardId || null,
      frequency,
      dayOfMonth: dayOfMonth ? Number(dayOfMonth) : null,
      nextDue: new Date(nextDue),
      scope: body.scope === "personal" ? "personal" : "casa",
    },
    include: {
      category: { select: { id: true, name: true, color: true } },
      creditCard: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(recurring, { status: 201 });
}
