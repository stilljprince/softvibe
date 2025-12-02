// app/api/account/credits/route.ts
import { prisma } from "@/lib/prisma";
import { requireAuth, jsonOk, jsonError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const auth = await requireAuth();
  if (!auth) {
    return jsonError("UNAUTHORIZED", 401, { message: "Bitte einloggen." });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { credits: true },
  });

  if (!user) {
    return jsonError("USER_NOT_FOUND", 404, { message: "User nicht gefunden." });
  }

  return jsonOk({ credits: user.credits }, 200);
}