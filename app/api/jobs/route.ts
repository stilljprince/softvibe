// app/api/jobs/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { CreateJobSchema } from "@/lib/validation/generate";
import { $Enums } from "@prisma/client";

export const runtime = "nodejs";

// 👇 hier stellst du ein, wie viele offene Jobs ein User max. haben darf
const MAX_OPEN_JOBS_PER_USER = 5;

// GET /api/jobs
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const take = Number(searchParams.get("take") ?? "20");
  const skip = Number(searchParams.get("skip") ?? "0");

  const jobs = await prisma.job.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      resultUrl: true,
      prompt: true,
      preset: true,
      durationSec: true,
      createdAt: true,
    },
    take: Math.min(take, 50),
    skip: Math.max(skip, 0),
  });

  return NextResponse.json(jobs);
}

// POST /api/jobs
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = CreateJobSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // ⏱️ 1. kleines Zeit-Rate-Limit (wie vorher)
  const WINDOW_MS = 5000;
  const since = new Date(Date.now() - WINDOW_MS);
  const recent = await prisma.job.findFirst({
    where: { userId: session.user.id, createdAt: { gt: since } },
    select: { id: true },
  });
  if (recent) {
    const retry = Math.ceil(WINDOW_MS / 1000);
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfterSeconds: retry },
      { status: 429, headers: { "Retry-After": String(retry) } }
    );
  }

  // 🆕 2. offenes-Job-Limit pro User
  // offen = QUEUED oder PROCESSING
  const openCount = await prisma.job.count({
    where: {
      userId: session.user.id,
      status: {
        in: [$Enums.JobStatus.QUEUED, $Enums.JobStatus.PROCESSING],
      },
    },
  });

  if (openCount >= MAX_OPEN_JOBS_PER_USER) {
    return NextResponse.json(
      {
        error: "TOO_MANY_OPEN_JOBS",
        message: `Du hast bereits ${openCount} offene Jobs. Bitte warte, bis einer fertig ist.`,
        maxOpenJobs: MAX_OPEN_JOBS_PER_USER,
      },
      { status: 429 }
    );
  }

  // 3. eigentlicher Create
  const { prompt, preset, durationSec } = parsed.data;

  const job = await prisma.job.create({
    data: {
      userId: session.user.id,
      prompt,
      preset,
      status: $Enums.JobStatus.QUEUED,
      ...(typeof durationSec === "number" ? { durationSec } : {}),
    },
    select: {
      id: true,
      status: true,
      prompt: true,
      preset: true,
      durationSec: true,
      createdAt: true,
    },
  });

  return NextResponse.json(job, { status: 201 });
}