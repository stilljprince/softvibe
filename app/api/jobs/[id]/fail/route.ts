// app/api/jobs/[id]/fail/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/"); // ["", "api", "jobs", "<id>", "fail"]
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

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      error: "Vom System / User manuell auf FAILED gesetzt.",
    },
    select: {
      id: true,
      status: true,
      resultUrl: true,
      prompt: true,
      preset: true,
      durationSec: true,
      createdAt: true,
      error: true,
    },
  });

  return NextResponse.json(updated);
}