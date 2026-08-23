import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/auth";
import { isHouseholdMemberEmail } from "@/lib/household";

/**
 * Sin UI a proposito: esta app es de uso privado de dos personas
 * (Leandro y Virginia) y el registro abierto no tiene sentido — la landing
 * ya no ofrece un boton "Registrarse" y no existe `src/app/(auth)/register/`.
 * Esta route se deja viva porque es la unica forma de crear una cuenta si
 * alguna vez hace falta (por ejemplo, para reemplazar un usuario borrado), y
 * ya esta detras de la allowlist `HOUSEHOLD_EMAILS` (ver `isHouseholdMemberEmail`
 * en `src/lib/household.ts`): un email fuera de la lista recibe 403.
 *
 * Para crear una cuenta con un email de la allowlist:
 *
 *   curl -X POST https://<dominio>/api/auth/register \
 *     -H "Content-Type: application/json" \
 *     -d '{"email":"alguien@delhogar.com","password":"...","name":"Alguien"}'
 */

export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json();

    if (!email || !password || !name) {
      return NextResponse.json({ error: "Todos los campos son requeridos" }, { status: 400 });
    }

    // El registro NO es publico: esta app es el tracker de gastos de un hogar
    // concreto, y quien tiene cuenta es, por definicion, miembro del hogar
    // (ver src/lib/household.ts). Sin este chequeo cualquiera que se
    // registrara en el dominio publico leia, editaba y borraba todo el
    // historial financiero.
    if (!isHouseholdMemberEmail(email)) {
      return NextResponse.json(
        { error: "Este email no esta habilitado para crear una cuenta" },
        { status: 403 }
      );
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json({ error: "El email ya esta registrado" }, { status: 400 });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashed, name },
    });

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
    return NextResponse.json({ error: "Error al registrar" }, { status: 500 });
  }
}
