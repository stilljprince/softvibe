// app/api/jobs/[id]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * GET /api/jobs/[id]
 * Eigene Job-Details holen (Status, Result-URL etc.)
 */
export async function GET(_req: Request, context: unknown) {
  const { params } = context as { params: { id: string } };

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.job.findFirst({
    where: { id: params.id, userId: session.user.id },
    select: {
      id: true,
      status: true,
      resultUrl: true,
      error: true,
      prompt: true,
      preset: true,
      createdAt: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(job);
}

/**
 * DELETE /api/jobs/[id]
 * Eigenen Job löschen. Gibt 204 No Content zurück.
 * Hinweis: Laut deinem Schema wird bei verknüpften Tracks `jobId` auf NULL gesetzt (onDelete: SetNull).
 */
export async function DELETE(_req: Request, context: unknown) {
  const { params } = context as { params: { id: string } };

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ownership prüfen: Nur eigene Jobs dürfen gelöscht werden
  const found = await prisma.job.findFirst({
    where: { id: params.id, userId: session.user.id },
    select: { id: true },
  });
  if (!found) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.job.delete({ where: { id: params.id } });
  return new NextResponse(null, { status: 204 });
}