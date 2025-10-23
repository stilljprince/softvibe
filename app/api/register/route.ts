// app/api/register/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hash } from "bcryptjs";
import { RegisterSchema } from "@/lib/validation/auth";

export const runtime = "nodejs";

// 👇 Test-Endpoint, damit du im Browser GET prüfen kannst
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "/api/register", method: "GET" });
}

export async function POST(req: Request) {
  try {
    const json = await req.json();

    const parsed = RegisterSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
    }

    const { name, email, password } = parsed.data;

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json({ error: "E-Mail bereits vergeben" }, { status: 409 });
    }

    const passwordHash = await hash(password, 12);
    const user = await prisma.user.create({
      data: { email, name, passwordHash },
    });

    return NextResponse.json({ ok: true, userId: user.id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Serverfehler" }, { status: 500 });
  }
}
