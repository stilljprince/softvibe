import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/stories/:id/tracks
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const story = await prisma.story.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, title: true },
  });
  if (!story) return jsonError("NOT_FOUND", 404);

  const tracks = await prisma.track.findMany({
    where: { userId: session.user.id, storyId: id },
    orderBy: [{ partIndex: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      url: true,
      durationSeconds: true,
      createdAt: true,
      isPublic: true,
      shareSlug: true,
      storyId: true,
      partIndex: true,
      partTitle: true,
    },
  });

  return jsonOk(
    {
      story: { id: story.id, title: story.title },
      tracks: tracks.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
      })),
    },
    200
  );
}