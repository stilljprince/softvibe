// app/api/tracks/[id]/route.ts
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
  const noCtrls = trimmed.replace(/[\u0000-\u001F\u007F]/g, "");
  return noCtrls.slice(0, 140);
}

// PATCH /api/tracks/[id]  -> Titel umbenennen
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const h = await headers();
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    log.warn(h, "tracks:rename:unauthorized");
    return jsonError("UNAUTHORIZED", 401);
  }

  const { id } = await ctx.params;
  log.info(h, "tracks:rename:start", { id });

  let body: PatchBody = {};
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    // ignore
  }

  if (!body.title || body.title.trim().length === 0) {
    log.warn(h, "tracks:rename:invalid_title", { id });
    return jsonError("INVALID_TITLE", 400, { message: "Titel darf nicht leer sein." });
  }

  const title = sanitizeTitle(body.title);

  const updated = await prisma.track
    .update({
      where: { id },
      data: { title },
      select: {
        id: true,
        title: true,
        url: true,
        durationSeconds: true,
        createdAt: true,
        userId: true,
      },
    })
    .catch(() => null);

  if (!updated) {
    log.warn(h, "tracks:rename:not_found", { id });
    return jsonError("NOT_FOUND", 404);
  }

  if (updated.userId !== session.user.id) {
    log.warn(h, "tracks:rename:forbidden", { id });
    return jsonError("FORBIDDEN", 403);
  }

  const { userId, ...safe } = updated;
  log.info(h, "tracks:rename:ok", { id });
  return jsonOk(safe, 200);
}

// DELETE /api/tracks/[id] -> Track löschen (DB + S3)
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const h = await headers();
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    log.warn(h, "tracks:delete:unauthorized");
    return jsonError("UNAUTHORIZED", 401);
  }

  const { id } = await ctx.params;
  log.info(h, "tracks:delete:start", { id });

  const track = await prisma.track.findUnique({
    where: { id },
    select: { id: true, userId: true, url: true, jobId: true },
  });

  if (!track) {
    log.warn(h, "tracks:delete:not_found", { id });
    return jsonError("NOT_FOUND", 404);
  }
  if (track.userId !== session.user.id) {
    log.warn(h, "tracks:delete:forbidden", { id });
    return jsonError("FORBIDDEN", 403);
  }

  // S3-Objekt best-effort löschen
  if (hasS3Env()) {
    const key = s3KeyFromUrl(track.url);
    if (key) {
      try {
        await deleteObjectByKey(key);
        log.info(h, "tracks:delete:s3_deleted", { id, key });
      } catch (err) {
        console.error("[tracks:delete] S3 delete failed", err);
        log.warn(h, "tracks:delete:s3_failed", { id, key });
        // kein Hard-Error – Track darf trotzdem aus DB raus
      }
    } else {
      log.warn(h, "tracks:delete:s3_key_missing", { id, url: track.url });
    }
  }

  await prisma.track.delete({ where: { id: track.id } });
  log.info(h, "tracks:delete:ok", { id });

  // 204: kein Body → bewusst ohne jsonOk
  return new NextResponse(null, { status: 204 });
}