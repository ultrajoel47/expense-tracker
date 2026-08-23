import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getHouseholdUserIds } from "@/lib/household";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Vincular un chat habilita a cargar gastos por el bot: es una capacidad de
  // miembro del hogar, no de cualquier sesion.
  const householdUserIds = await getHouseholdUserIds();
  if (!householdUserIds.includes(session.id)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const code = randomBytes(4).toString("hex");

  await prisma.user.update({
    where: { id: session.id },
    data: { telegramLinkCode: code },
  });

  return NextResponse.json({ code });
}
