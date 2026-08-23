import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getHouseholdUserIds } from "@/lib/household";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Esta ruta devuelve nombre Y email de las otras cuentas, asi que no alcanza
  // con estar autenticado: hay que ser miembro del hogar. Un principal fuera
  // del set no recibe la lista recortada, recibe un 403 — devolverle `[]`
  // seria mas prolijo pero acá el filtro no lo protege: la lista es de los
  // OTROS, asi que un `{ in: miembros }` se la daria completa.
  const householdUserIds = await getHouseholdUserIds();
  if (!householdUserIds.includes(session.id)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { id: { in: householdUserIds, not: session.id } },
    select: { id: true, name: true, email: true },
  });

  return NextResponse.json(users);
}
