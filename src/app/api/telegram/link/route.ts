import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const code = randomBytes(4).toString("hex");

  await prisma.user.update({
    where: { id: session.id },
    data: { telegramLinkCode: code },
  });

  return NextResponse.json({ code });
}
