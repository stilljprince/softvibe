// app/api/account/avatar/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";
import { AVATAR_PRESETS } from "@/lib/avatars";

export const runtime = "nodejs";

const VALID_KEYS = new Set(AVATAR_PRESETS.map((p) => p.key));

// PATCH /api/account/avatar — save the user's chosen avatar key
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const body = await req.json().catch(() => null);
  const avatarKey = typeof body?.avatarKey === "string" ? body.avatarKey : null;

  if (avatarKey !== null && !VALID_KEYS.has(avatarKey)) {
    return jsonError("Invalid avatarKey", 400);
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { avatarKey },
  });

  return jsonOk({ avatarKey });
}
