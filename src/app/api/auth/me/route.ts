import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, name: true, telegramChatId: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  // Se expone el booleano, no el chatId: la UI solo necesita saber si hay que
  // ofrecer la vinculacion, y el id del chat no le sirve para nada.
  const { telegramChatId, ...rest } = user;
  return NextResponse.json({ user: { ...rest, telegramLinked: Boolean(telegramChatId) } });
}
