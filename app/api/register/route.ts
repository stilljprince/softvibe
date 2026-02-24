// app/api/register/route.ts
import { prisma } from "@/lib/prisma";
import { hash } from "bcryptjs";
import { RegisterSchema } from "@/lib/validation/auth";
import { jsonOk, jsonError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET() {
  return jsonOk({ ok: true, endpoint: "/api/register", method: "GET" }, 200);
}

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = RegisterSchema.safeParse(json);
    if (!parsed.success) {
      return jsonError("Ungültige Eingabe", 400);
    }

    const { name, email, password } = parsed.data;

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return jsonError("E-Mail bereits vergeben", 409);
    }

    const passwordHash = await hash(password, 12);
        const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        credits: 50,      // z.B. 50 Test-Credits
        isAdmin: false,   // normale User
      },
    });
    return jsonOk({ ok: true, userId: user.id }, 200);
  } catch (err) {
    console.error(err);
    return jsonError("Serverfehler", 500);
  }
}