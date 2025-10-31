// app/api/jobs/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// GET /api/jobs/:id
export async function GET(req: NextRequest, ctx: unknown) {
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

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(job);
}

// DELETE /api/jobs/:id
export async function DELETE(req: NextRequest, ctx: unknown) {
  const { params } = ctx as { params: { id: string } };
  const jobId = params.id;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.job.findFirst({
    where: {
      id: jobId,
      userId: session.user.id,
    },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.job.delete({
    where: { id: jobId },
  });

  return new NextResponse(null, { status: 204 });
}