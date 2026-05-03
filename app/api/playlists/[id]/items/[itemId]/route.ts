// app/api/playlists/[id]/items/[itemId]/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";

// DELETE /api/playlists/[id]/items/[itemId] — remove an item from a playlist
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { id, itemId } = await ctx.params;

  const item = await prisma.playlistItem.findUnique({
    where: { id: itemId },
    include: { playlist: { select: { userId: true } } },
  });
  if (!item) return jsonError("Not found", 404);
  if (item.playlistId !== id) return jsonError("Not found", 404);
  if (item.playlist.userId !== session.user.id) return jsonError("Forbidden", 403);

  await prisma.playlistItem.delete({ where: { id: itemId } });

  // Update playlist updatedAt
  await prisma.playlist.update({ where: { id }, data: { updatedAt: new Date() } }).catch(() => null);

  return new Response(null, { status: 204 });
}
