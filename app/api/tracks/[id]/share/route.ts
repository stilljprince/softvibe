// app/api/tracks/[id]/share/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import { log } from "@/lib/log";
import { jsonOk, jsonError } from "@/lib/api";

export const runtime = "nodejs";

type SharePatchBody = {
  isPublic?: boolean;
};

// kleine Hilfsfunktion für Slug (keine extra Lib nötig)
function generateShareSlug(): string {
  // z.B. 10-stellig, alphanumerisch
  return Math.random().toString(36).slice(2, 12);
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const h = await headers();
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    log.warn(h, "tracks:share:unauthorized");
    return jsonError("UNAUTHORIZED", 401);
  }

  const { id } = await ctx.params;
  log.info(h, "tracks:share:start", { id });

  let body: SharePatchBody = {};
  try {
    body = (await req.json()) as SharePatchBody;
  } catch {
    // ignorieren → body bleibt {}
  }

  if (typeof body.isPublic !== "boolean") {
    log.warn(h, "tracks:share:invalid_body", { id });
    return jsonError("INVALID_BODY", 400, {
      message: "isPublic (boolean) wird benötigt.",
    });
  }

  // Track laden
  const track = await prisma.track.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      isPublic: true,
      shareSlug: true,
    },
  });

  if (!track) {
    log.warn(h, "tracks:share:not_found", { id });
    return jsonError("NOT_FOUND", 404);
  }

  if (track.userId !== session.user.id) {
    log.warn(h, "tracks:share:forbidden", { id });
    return jsonError("FORBIDDEN", 403);
  }

  const wantPublic = body.isPublic;

  let nextSlug = track.shareSlug;
  // wenn jetzt öffentlich und es gibt noch keinen Slug → einen erzeugen
  if (wantPublic && !nextSlug) {
    nextSlug = generateShareSlug();
  }

  const updated = await prisma.track.update({
    where: { id },
    data: {
      isPublic: wantPublic,
      // wenn du Slug beim De-Publicen behalten willst → nextSlug lassen,
      // sonst auf null setzen:
      shareSlug: wantPublic ? nextSlug : null,
    },
    select: {
      id: true,
      isPublic: true,
      shareSlug: true,
    },
  });

  log.info(h, "tracks:share:ok", {
    id: updated.id,
    isPublic: updated.isPublic,
  });

  // Frontend erwartet aktuell: { isPublic, shareSlug }
  return jsonOk(
    {
      isPublic: updated.isPublic,
      shareSlug: updated.shareSlug,
    },
    200
  );
}