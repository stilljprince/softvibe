// app/api/jobs/[id]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = {
  params: {
    id: string;
  };
};

// GET /api/jobs/:id  → einzelner Job (nur eigener!)
export async function GET(_req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.job.findFirst({
    where: {
      id: params.id,
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

// DELETE /api/jobs/:id  → zum „Löschen“-Button in deiner UI
export async function DELETE(_req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // vorher prüfen, ob der Job dem User gehört
  const exists = await prisma.job.findFirst({
    where: {
      id: params.id,
      userId: session.user.id,
    },
    select: { id: true },
  });

  if (!exists) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.job.delete({
    where: { id: params.id },
  });

  return new NextResponse(null, { status: 204 });
}