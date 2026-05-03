// app/api/stories/[id]/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/stories/:id  — detail for variation reference loading
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const story = await prisma.story.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id:         true,
      title:      true,
      preset:     true,
      scriptText: true,
      tracks: {
        take: 1,
        orderBy: { partIndex: "asc" },
        include: {
          job: { select: { prompt: true, durationSec: true } },
        },
      },
    },
  });

  if (!story) return jsonError("NOT_FOUND", 404);

  const firstTrack = story.tracks[0];

  return jsonOk({
    id:              story.id,
    title:           story.title,
    preset:          story.preset,
    scriptText:      story.scriptText ?? null,
    prompt:          firstTrack?.job?.prompt ?? null,
    durationSeconds: firstTrack?.job?.durationSec ?? null,
  }, 200);
}
