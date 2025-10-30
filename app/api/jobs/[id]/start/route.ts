// app/api/jobs/[id]/start/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { $Enums } from "@prisma/client";

export const runtime = "nodejs";

export async function POST(_req: Request, context: unknown) {
  // wie beim complete: im Prod sperren
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const { params } = context as { params: { id: string } };

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // gehört der Job dem User?
  const job = await prisma.job.findFirst({
    where: { id: params.id, userId: session.user.id },
    select: { id: true, status: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // nur aus QUEUED startbar
  if (job.status !== $Enums.JobStatus.QUEUED) {
    return NextResponse.json({ error: "Invalid state" }, { status: 409 });
  }

  const updated = await prisma.job.update({
    where: { id: job.id },
    data: { status: $Enums.JobStatus.PROCESSING },
    select: { id: true, status: true },
  });

  return NextResponse.json(updated);
}