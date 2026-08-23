import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/auth";
import { isHouseholdMemberEmail } from "@/lib/household";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email y password son requeridos" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: "Credenciales invalidas" }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return NextResponse.json({ error: "Credenciales invalidas" }, { status: 401 });
    }

    if (!isHouseholdMemberEmail(user.email)) {
      console.error(
        `Login rechazado: ${user.email} tiene cuenta pero NO esta en HOUSEHOLD_EMAILS. ` +
          `Si es un miembro legitimo, es un typo en la variable de entorno.`
      );
      return NextResponse.json(
        { error: "Esta cuenta no esta habilitada en esta instalacion" },
        { status: 403 }
      );
    }

    const token = signToken({ id: user.id, email: user.email });

    const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
    res.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return res;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Error al iniciar sesion" }, { status: 500 });
  }
}
