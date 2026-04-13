// app/api/playlists/[id]/items/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";
import type { Job, Story } from "@prisma/client";

export const runtime = "nodejs";

type TrackRow = {
  id: string;
  title: string;
  url: string;
  durationSeconds: number | null;
  createdAt: Date;
  isPublic: boolean;
  shareSlug: string | null;
  storyId: string | null;
  partIndex: number | null;
  partTitle: string | null;
  job: Pick<Job, "title" | "prompt" | "preset"> | null;
  story: Pick<Story, "title"> | null;
};

function formatTrack(t: TrackRow) {
  return {
    id: t.id,
    title: t.title,
    url: t.url,
    durationSeconds: t.durationSeconds,
    createdAt: t.createdAt.toISOString(),
    isPublic: t.isPublic,
    shareSlug: t.shareSlug,
    storyId: t.storyId,
    storyTitle: t.story?.title ?? null,
    partIndex: t.partIndex,
    partTitle: t.partTitle,
    jobTitle: t.job?.title ?? null,
    prompt: t.job?.prompt ?? null,
    preset: t.job?.preset ?? null,
  };
}

// GET /api/playlists/[id]/items — ordered items with full track data
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { id } = await ctx.params;

  const pl = await prisma.playlist.findUnique({ where: { id }, select: { userId: true } });
  if (!pl) return jsonError("Not found", 404);
  if (pl.userId !== session.user.id) return jsonError("Forbidden", 403);

  const items = await prisma.playlistItem.findMany({
    where: { playlistId: id },
    orderBy: { position: "asc" },
    include: {
      track: {
        include: {
          job: { select: { title: true, prompt: true, preset: true } },
          story: { select: { title: true } },
        },
      },
    },
  });

  return jsonOk({
    items: items.map((item) => ({
      id: item.id,
      position: item.position,
      track: formatTrack(item.track),
    })),
  });
}

// POST /api/playlists/[id]/items — add a track to the playlist
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const { id } = await ctx.params;

  const pl = await prisma.playlist.findUnique({ where: { id }, select: { userId: true } });
  if (!pl) return jsonError("Not found", 404);
  if (pl.userId !== session.user.id) return jsonError("Forbidden", 403);

  const body = await req.json().catch(() => null);
  const trackId = typeof body?.trackId === "string" ? body.trackId.trim() : "";
  if (!trackId) return jsonError("trackId required", 400);

  const track = await prisma.track.findUnique({ where: { id: trackId }, select: { userId: true } });
  if (!track) return jsonError("Track not found", 404);
  if (track.userId !== session.user.id) return jsonError("Forbidden", 403);

  const maxPos = await prisma.playlistItem.aggregate({
    where: { playlistId: id },
    _max: { position: true },
  });
  const position = (maxPos._max.position ?? -1) + 1;

  try {
    const item = await prisma.playlistItem.create({
      data: { playlistId: id, trackId, position },
    });

    // Update playlist updatedAt
    await prisma.playlist.update({ where: { id }, data: { updatedAt: new Date() } });

    return jsonOk({ id: item.id, position: item.position }, 201);
  } catch {
    // Unique constraint violation — track already in playlist
    return jsonError("Already in playlist", 409);
  }
}
