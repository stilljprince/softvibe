import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { CreateJobSchema } from "@/lib/validation/generate";
import { $Enums } from "@prisma/client";

export const runtime = "nodejs";

// LIST
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await prisma.job.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      resultUrl: true,
      prompt: true,
      preset: true,
      createdAt: true,
    },
    take: 50,
  });

  return NextResponse.json(jobs);
}

// CREATE (mit einfachem Rate-Limit)
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

  // 🔒 Rate-Limit: 1 Create pro 5s
  const WINDOW_MS = 5000;
  const since = new Date(Date.now() - WINDOW_MS);
  const recent = await prisma.job.findFirst({
    where: { userId: session.user.id, createdAt: { gt: since } },
    select: { id: true, createdAt: true },
  });
  if (recent) {
    const headers = { "Retry-After": String(Math.ceil(WINDOW_MS / 1000)) };
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfterSeconds: Math.ceil(WINDOW_MS / 1000) },
      { status: 429, headers }
    );
  }

  const { prompt, preset } = parsed.data;

  const job = await prisma.job.create({
    data: {
      userId: session.user.id,
      prompt,
      preset,
      status: $Enums.JobStatus.QUEUED,
    },
    select: { id: true, status: true },
  });

  return NextResponse.json(job, { status: 201 });
}