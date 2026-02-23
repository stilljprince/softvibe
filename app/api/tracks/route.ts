// app/api/tracks/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { jsonOk, jsonError } from "@/lib/api";

export const runtime = "nodejs";

type CreateBody = {
  jobId: string;
  title?: string;
  partIndex?: number;
};

// GET /api/tracks?take=10&cursor=2025-11-05T10:00:00.000Z::ckxyz...&q=story
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  const { searchParams } = new URL(req.url);
  const take = Math.min(
    Math.max(Number(searchParams.get("take") ?? "10"), 1),
    50
  );
  const q = (searchParams.get("q") ?? "").trim();
  const cursor = searchParams.get("cursor") ?? "";
const storyId = (searchParams.get("storyId") ?? "").trim();

  let createdAtCursor: Date | null = null;
  let idCursor: string | null = null;
  if (cursor.includes("::")) {
    const [iso, id] = cursor.split("::");
    if (iso && id) {
      const dt = new Date(iso);
      if (!Number.isNaN(dt.getTime())) {
        createdAtCursor = dt;
        idCursor = id;
      }
    }
  }

  // Basis-Filter: Tracks des Users
      const whereBase: Prisma.TrackWhereInput = {
    userId: session.user.id,
    ...(storyId ? { storyId } : {} ),
  };

  // Optional: Textsuche in Titel oder Prompt (vom Job)
  if (q) {
    whereBase.OR = [
      {
        title: {
          contains: q,
          mode: "insensitive",
        },
      },
      {
        job: {
          prompt: {
            contains: q,
            mode: "insensitive",
          },
        },
      },
    ];
  }

  const whereWithCursor =
    createdAtCursor && idCursor
      ? {
          AND: [
            whereBase,
            {
              OR: [
                { createdAt: { lt: createdAtCursor } },
                {
                  AND: [
                    { createdAt: createdAtCursor },
                    { id: { lt: idCursor } },
                  ],
                },
              ],
            },
          ],
        }
      : whereBase;

  // 🔹 WICHTIG: Job-Relation mitladen, damit wir title/prompt vom Job haben
  const rows = await prisma.track.findMany({
    where: whereWithCursor,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
  job: { select: { title: true, prompt: true } },
  story: { select: { id: true, title: true } },
},
    take,
  });
// ✅ Quick-fix: Kapitel innerhalb einer Story sauber sortieren
rows.sort((a, b) => {
  const as = a.storyId ?? "";
  const bs = b.storyId ?? "";

  // gleiche Story -> nach partIndex aufsteigend
  if (as && bs && as === bs) {
    const ai = typeof a.partIndex === "number" ? a.partIndex : 0;
    const bi = typeof b.partIndex === "number" ? b.partIndex : 0;
    return ai - bi;
  }

  // sonst wie vorher: neueste zuerst
  return b.createdAt.getTime() - a.createdAt.getTime();
});

  const last = rows[rows.length - 1];
  const nextCursor = last
    ? `${last.createdAt.toISOString()}::${last.id}`
    : null;

  // 🔹 Titel & Prompt ausschließlich vom Job ableiten
  const items = rows.map((t) => {
  const jobTitle = (t.job?.title ?? "").trim();   // ✅ fehlt bei dir
  const jobPrompt = (t.job?.prompt ?? "").trim();
const baseTitle = (t.title ?? "").trim() || jobTitle || "SoftVibe Track";
const withChapter =
  t.storyId && typeof t.partIndex === "number"
    ? `${baseTitle} · ${t.partTitle?.trim() || `Chapter ${t.partIndex + 1}`}`
    : baseTitle;

  const chapterLabel =
    t.storyId && typeof t.partIndex === "number"
      ? `Chapter ${t.partIndex + 1}`
      : null;

  return {
    id: t.id,
    title: withChapter,
    prompt: jobPrompt || null,
    url: t.url,
    durationSeconds: t.durationSeconds,
    createdAt: t.createdAt.toISOString(),
    isPublic: t.isPublic,
    shareSlug: t.shareSlug,
    storyId: t.storyId ?? null,
    storyTitle: (t.story?.title ?? "").trim() || null,
    partIndex: typeof t.partIndex === "number" ? t.partIndex : null,
    partTitle: (t.partTitle ?? "").trim() || chapterLabel || null, // optional fallback
  };
});

  return jsonOk(
    {
      items,
      nextCursor,
    },
    200
  );
}
// POST /api/tracks  body: { jobId, title? }
// Upsert-Logik: Falls (userId,url) schon existiert → Titel (falls mitgegeben) aktualisieren statt duplizieren
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  let body: CreateBody | null = null;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    // ignore
  }
  if (!body || !body.jobId) {
    return jsonError("Missing jobId", 400);
  }
const partIndex =
  typeof body.partIndex === "number" && Number.isFinite(body.partIndex)
    ? Math.max(0, Math.floor(body.partIndex))
    : null;

  const job = await prisma.job.findFirst({
    where: { id: body.jobId, userId: session.user.id },
    select: { id: true, resultUrl: true, durationSec: true, prompt: true },
  });
  if (!job) {
    return jsonError("JOB_NOT_FOUND", 404);
  }
  if (!job.resultUrl) {
    return jsonError("JOB_HAS_NO_AUDIO", 400);
  }

  const proposedTitle =
    (body.title && body.title.trim() !== ""
      ? body.title.trim()
      : (job.prompt ?? "").trim().slice(0, 80)) || "SoftVibe Track";

  // Prüfe, ob bereits Track mit gleicher URL existiert
  const existing = await prisma.track.findFirst({
    where: { userId: session.user.id, url: job.resultUrl },
    select: { id: true, title: true, url: true, durationSeconds: true, createdAt: true },
  });

  if (existing) {
    // optional Titel aktualisieren (nur wenn abweichend und body.title vorhanden ist)
    if (body.title && body.title.trim() !== "" && body.title.trim() !== existing.title) {
      const updated = await prisma.track.update({
          where: { id: existing.id },
          data: {
            title: proposedTitle,
            ...(partIndex !== null ? { partIndex } : {}),
          },
          select: { id: true, title: true, url: true, durationSeconds: true, createdAt: true },
        });
      return jsonOk(
        { ...updated, createdAt: updated.createdAt.toISOString(), updated: true },
        200
      );
    }
    // sonst idempotent zurückgeben
    return jsonOk(
      { ...existing, createdAt: existing.createdAt.toISOString(), updated: false },
      200
    );
  }

  // neu anlegen
  const created = await prisma.track.create({
    data: {
      userId: session.user.id,
      jobId: job.id,
      title: proposedTitle,
      url: job.resultUrl,
      durationSeconds: job.durationSec ?? null,
      ...(partIndex !== null ? { partIndex } : {}),
    },
    select: { id: true, title: true, url: true, durationSeconds: true, createdAt: true },
  });

  return jsonOk(
    { ...created, createdAt: created.createdAt.toISOString(), created: true },
    201
  );
}