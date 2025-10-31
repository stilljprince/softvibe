// app/api/jobs/[id]/fail/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { $Enums } from "@prisma/client";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.job.findFirst({
    where: {
      id: params.id,
      userId: session.user.id,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.job.update({
    where: { id: params.id },
    data: {
      status: $Enums.JobStatus.FAILED,
      error: "Mock: Verarbeitung fehlgeschlagen.",
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