// app/api/jobs/[id]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/"); // ['', 'api', 'jobs', '<id>']
  const jobId = parts[3];

  if (!jobId) {
    return NextResponse.json({ error: "Job ID missing" }, { status: 400 });
  }

  // 🔐 System-Header prüfen
  const systemSecret = req.headers.get("x-softvibe-job-secret");
  const isSystem =
    systemSecret && systemSecret === process.env.JOB_SYSTEM_SECRET;

  let userId: string | null = null;
  if (!isSystem) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = session.user.id;
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
      status: true,
      prompt: true,
      preset: true,
      durationSec: true,
      resultUrl: true,
      error: true,
      createdAt: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 👤 wenn kein System-Call → Ownership prüfen
  if (!isSystem && job.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(job);
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const jobId = parts[3];

  if (!jobId) {
    return NextResponse.json({ error: "Job ID missing" }, { status: 400 });
  }

  const systemSecret = req.headers.get("x-softvibe-job-secret");
  const isSystem =
    systemSecret && systemSecret === process.env.JOB_SYSTEM_SECRET;

  let userId: string | null = null;
  if (!isSystem) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = session.user.id;
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!isSystem && job.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.job.delete({
    where: { id: jobId },
  });

  return new NextResponse(null, { status: 204 });
}