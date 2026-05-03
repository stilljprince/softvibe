// app/api/playlists/[id]/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";
import { PLAYLIST_COVERS } from "@/lib/playlist-covers";

export const runtime = "nodejs";

const VALID_COVER_KEYS = new Set(PLAYLIST_COVERS.map((c) => c.key));

// PATCH /api/playlists/[id] — rename, toggle pin, or set cover
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);

  const pl = await prisma.playlist.findUnique({ where: { id }, select: { userId: true } });
  if (!pl) return jsonError("Not found", 404);
  if (pl.userId !== session.user.id) return jsonError("Forbidden", 403);

  const data: { name?: string; pinned?: boolean; coverKey?: string | null } = {};

  if (typeof body?.name === "string") {
    const name = body.name.trim().slice(0, 100);
    if (!name) return jsonError("Name required", 400);
    data.name = name;
  }

  if (typeof body?.pinned === "boolean") {
    data.pinned = body.pinned;
  }

  if (body !== null && typeof body === "object" && "coverKey" in body) {
    const ck = (body as Record<string, unknown>).coverKey;
    if (ck !== null && (typeof ck !== "string" || !VALID_COVER_KEYS.has(ck))) {
      return jsonError("Invalid coverKey", 400);
    }
    data.coverKey = (ck as string | null) ?? null;
  }

  if (Object.keys(data).length === 0) return jsonError("Nothing to update", 400);

  const updated = await prisma.playlist.update({ where: { id }, data });
  return jsonOk({ id: updated.id, name: updated.name, pinned: updated.pinned, position: updated.position, coverKey: updated.coverKey });
}

// DELETE /api/playlists/[id] — delete a playlist (cascades to items)
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { id } = await ctx.params;

  const pl = await prisma.playlist.findUnique({ where: { id }, select: { userId: true } });
  if (!pl) return jsonError("Not found", 404);
  if (pl.userId !== session.user.id) return jsonError("Forbidden", 403);

  await prisma.playlist.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
