// app/api/jobs/[id]/complete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { $Enums } from "@prisma/client";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: unknown) {
  // ctx auf das erwartete Format casten
  const { params } = ctx as { params: { id: string } };
  const jobId = params.id;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      userId: session.user.id,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: $Enums.JobStatus.DONE,
      // Dummy-URL für deine UI
      resultUrl: job.resultUrl ?? "https://example.com/fake-asmr.mp3",
    },
    select: {
      id: true,
      status: true,
      resultUrl: true,
      prompt: true,
      preset: true,
      error: true,
      createdAt: true,
    },
  });

  return NextResponse.json(updated);
}