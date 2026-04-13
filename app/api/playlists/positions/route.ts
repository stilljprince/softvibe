// app/api/playlists/positions/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";

export const runtime = "nodejs";

// PATCH /api/playlists/positions — bulk update playlist positions after drag-and-drop reorder
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.items)) return jsonError("items required", 400);

  const items = body.items as { id: string; position: number }[];
  if (items.length === 0) return jsonOk({});
  if (items.some((i) => typeof i.id !== "string" || typeof i.position !== "number")) {
    return jsonError("Invalid items", 400);
  }

  // Verify all playlists belong to this user
  const ids = items.map((i) => i.id);
  const owned = await prisma.playlist.findMany({
    where: { id: { in: ids }, userId: session.user.id },
    select: { id: true },
  });
  if (owned.length !== ids.length) return jsonError("Forbidden", 403);

  await prisma.$transaction(
    items.map((item) =>
      prisma.playlist.update({
        where: { id: item.id },
        data: { position: item.position },
      })
    )
  );

  return jsonOk({});
}
