// app/api/jobs/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { CreateJobSchema } from "@/lib/validation/generate";
import { $Enums } from "@prisma/client";

export const runtime = "nodejs";

// LIST (mit optional ?take und ?skip)
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const take = Number(searchParams.get("take") ?? "20");
  const skip = Number(searchParams.get("skip") ?? "0");

  const jobs = await prisma.job.findMany({
    where: { userId: session.user.id as string },
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
    take: Math.min(isFinite(take) ? take : 20, 50), // Hard-Limit
    skip: Math.max(isFinite(skip) ? skip : 0, 0),
  });

  return NextResponse.json(jobs);
}

// CREATE (mit Rate-Limit + robuster User-Resolve)
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Body robust lesen
    const raw = await req.json().catch(() => ({} as unknown));

    const parsed = CreateJobSchema.safeParse(raw);
    if (!parsed.success) {
      const details = parsed.error.flatten();
      return NextResponse.json({ error: "BAD_REQUEST", details }, { status: 400 });
    }
    const { prompt, preset, durationSec } = parsed.data as {
      prompt: string;
      preset?: string | null;
      durationSec?: number | null;
    };

    // 🔧 WICHTIG: User-ID frisch aus DB auflösen
    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [
          { id: session.user.id as string },
          ...(session.user.email ? [{ email: session.user.email as string }] : []),
        ],
      },
      select: { id: true },
    });

    if (!dbUser) {
      return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 401 });
    }

    // kleines Rate-Limit
    const WINDOW_MS = 5000;
    const since = new Date(Date.now() - WINDOW_MS);
    const recent = await prisma.job.findFirst({
      where: { userId: dbUser.id, createdAt: { gt: since } },
      select: { id: true },
    });
    if (recent) {
      const retryAfter = Math.ceil(WINDOW_MS / 1000);
      return NextResponse.json(
        { error: "RATE_LIMITED", retryAfterSeconds: retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    // Job anlegen
    const job = await prisma.job.create({
      data: {
        userId: dbUser.id, // ✅ garantiert existent → kein FK-Fehler
        prompt,
        preset: preset ?? null,
        status: $Enums.JobStatus.QUEUED,
        durationSec: typeof durationSec === "number" ? durationSec : null,
      },
      select: { id: true, status: true },
    });

    return NextResponse.json(job, { status: 201 });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return NextResponse.json(
      { error: "INTERNAL_ERROR", code: err.code ?? null, message: err.message ?? "unknown" },
      { status: 500 }
    );
  }
}