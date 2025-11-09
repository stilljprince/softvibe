// app/api/tracks/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type CreateBody = {
  jobId: string;
  title?: string;
};

// GET /api/tracks?take=10&cursor=2025-11-05T10:00:00.000Z::ckxyz...&q=story
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const take = Math.min(Math.max(Number(searchParams.get("take") ?? "10"), 1), 50);
  const q = (searchParams.get("q") ?? "").trim();
  const cursor = searchParams.get("cursor") ?? "";

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

  const whereBase = {
    userId: session.user.id,
    ...(q
      ? {
          title: {
            contains: q,
            mode: "insensitive" as const,
          },
        }
      : {}),
  };

  const whereWithCursor =
    createdAtCursor && idCursor
      ? {
          AND: [
            whereBase,
            {
              OR: [
                { createdAt: { lt: createdAtCursor } },
                { AND: [{ createdAt: createdAtCursor }, { id: { lt: idCursor } }] },
              ],
            },
          ],
        }
      : whereBase;

  const items = await prisma.track.findMany({
    where: whereWithCursor,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, title: true, url: true, durationSeconds: true, createdAt: true },
    take,
  });

  const last = items[items.length - 1];
  const nextCursor = last ? `${last.createdAt.toISOString()}::${last.id}` : null;

  return NextResponse.json(
    {
      items: items.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
      })),
      nextCursor,
    },
    { status: 200 }
  );
}

// POST /api/tracks  body: { jobId, title? }
// Upsert-Logik: Falls (userId,url) schon existiert → Titel (falls mitgegeben) aktualisieren statt duplizieren
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateBody | null = null;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    // ignore
  }
  if (!body || !body.jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = await prisma.job.findFirst({
    where: { id: body.jobId, userId: session.user.id },
    select: { id: true, resultUrl: true, durationSec: true, prompt: true },
  });
  if (!job) {
    return NextResponse.json({ error: "JOB_NOT_FOUND" }, { status: 404 });
  }
  if (!job.resultUrl) {
    return NextResponse.json({ error: "JOB_HAS_NO_AUDIO" }, { status: 400 });
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
        data: { title: proposedTitle },
        select: { id: true, title: true, url: true, durationSeconds: true, createdAt: true },
      });
      return NextResponse.json(
        { ...updated, createdAt: updated.createdAt.toISOString(), updated: true },
        { status: 200 }
      );
    }
    // sonst idempotent zurückgeben
    return NextResponse.json(
      { ...existing, createdAt: existing.createdAt.toISOString(), updated: false },
      { status: 200 }
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
    },
    select: { id: true, title: true, url: true, durationSeconds: true, createdAt: true },
  });

  return NextResponse.json(
    { ...created, createdAt: created.createdAt.toISOString(), created: true },
    { status: 201 }
  );
}