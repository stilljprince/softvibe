// app/api/stories/[id]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import { log } from "@/lib/log";
import { jsonOk, jsonError } from "@/lib/api";
import { hasS3Env, deleteObjectByKey, s3KeyFromUrl } from "@/lib/s3";

export const runtime = "nodejs";

type PatchBody = {
  title?: string;
};

function sanitizeTitle(t: string): string {
  const trimmed = t.trim();
  let out = "";
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code >= 32 && code !== 127) out += trimmed[i];
  }
  return out.slice(0, 140);
}

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

// PATCH /api/stories/:id  — rename a story (updates Story.title only)
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const h = await headers();
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    log.warn(h, "stories:rename:unauthorized");
    return jsonError("UNAUTHORIZED", 401);
  }

  const { id } = await ctx.params;
  log.info(h, "stories:rename:start", { id });

  let body: PatchBody = {};
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    // ignore
  }

  if (!body.title || body.title.trim().length === 0) {
    log.warn(h, "stories:rename:invalid_title", { id });
    return jsonError("INVALID_TITLE", 400, { message: "Titel darf nicht leer sein." });
  }

  const title = sanitizeTitle(body.title);

  const existing = await prisma.story.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });

  if (!existing) {
    log.warn(h, "stories:rename:not_found", { id });
    return jsonError("NOT_FOUND", 404);
  }
  if (existing.userId !== session.user.id) {
    log.warn(h, "stories:rename:forbidden", { id });
    return jsonError("FORBIDDEN", 403);
  }

  const updated = await prisma.story.update({
    where: { id },
    data: { title },
    select: { id: true, title: true },
  });

  log.info(h, "stories:rename:ok", { id });
  return jsonOk(updated, 200);
}

// DELETE /api/stories/[id] -> Story löschen (DB + S3)
// Cascade (Prisma schema): Story → Track → PlaylistItem werden automatisch entfernt.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const h = await headers();
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    log.warn(h, "stories:delete:unauthorized");
    return jsonError("UNAUTHORIZED", 401);
  }

  const { id } = await ctx.params;

  const story = await prisma.story.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      tracks: { select: { id: true, url: true } },
    },
  });

  if (!story) {
    log.warn(h, "stories:delete:not_found", { id });
    return jsonError("NOT_FOUND", 404);
  }
  if (story.userId !== session.user.id) {
    log.warn(h, "stories:delete:forbidden", { id });
    return jsonError("FORBIDDEN", 403);
  }

  // S3-Objekte best-effort löschen (pro Kapitel-Track), bevor die DB-Zeilen verschwinden.
  if (hasS3Env()) {
    for (const t of story.tracks) {
      const key = s3KeyFromUrl(t.url);
      if (!key) {
        log.warn(h, "stories:delete:s3_key_missing", { id, trackId: t.id, url: t.url });
        continue;
      }
      try {
        await deleteObjectByKey(key);
        log.info(h, "stories:delete:s3_deleted", { id, trackId: t.id, key });
      } catch (err) {
        console.error("[stories:delete] S3 delete failed", err);
        log.warn(h, "stories:delete:s3_failed", { id, trackId: t.id, key });
        // kein Hard-Error – Story darf trotzdem aus DB raus
      }
    }
  }

  // Cascade entfernt Tracks und referenzierende PlaylistItems automatisch.
  try {
    await prisma.story.delete({ where: { id: story.id } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError("DELETE_FAILED", 500, { message });
  }
  log.info(h, "stories:delete:ok", { id });

  // 204: kein Body → bewusst ohne jsonOk
  return new NextResponse(null, { status: 204 });
}
