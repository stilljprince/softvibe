// app/api/tracks/public-meta/route.ts
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") ?? "").trim();

  if (!slug) {
    return jsonError("MISSING_SLUG", 400, {
      message: "slug ist erforderlich.",
    });
  }

  const track = await prisma.track.findFirst({
    where: {
      shareSlug: slug,
      isPublic: true,
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      durationSeconds: true,
      job: {
        select: {
          preset: true,
        },
      },
    },
  });

  if (!track) {
    return jsonError("NOT_FOUND", 404, {
      message: "Kein öffentlicher Track zu diesem Slug gefunden.",
    });
  }

  return jsonOk(
    {
      id: track.id,
      title: track.title,
      createdAt: track.createdAt
        ? track.createdAt.toISOString()
        : null,
      durationSeconds: track.durationSeconds ?? null,
      preset: track.job?.preset ?? null,
    },
    200
  );
}