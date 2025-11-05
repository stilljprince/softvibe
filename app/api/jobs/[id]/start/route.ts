// app/api/jobs/[id]/start/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> } // 👈 Promise-Params
) {
  const { id } = await ctx.params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.job.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, status: true },
  });
  if (!job) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // idempotent: wenn schon PROCESSING, ok
  if (job.status === "PROCESSING") {
    return NextResponse.json({ id, status: job.status }, { status: 200 });
  }

  if (job.status !== "QUEUED") {
    return NextResponse.json(
      { error: "INVALID_STATE", status: job.status },
      { status: 409 }
    );
  }

  const updated = await prisma.job.update({
    where: { id },
    data: { status: "PROCESSING" },
    select: { id: true, status: true },
  });

  return NextResponse.json(updated, { status: 200 });
}