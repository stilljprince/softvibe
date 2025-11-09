// app/api/tracks/[id]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type PatchBody = {
  title?: string;
};

function sanitizeTitle(t: string): string {
  const trimmed = t.trim();
  // einfache Sanitization; keine Steuerzeichen, harte Längenbegrenzung
  const noCtrls = trimmed.replace(/[\u0000-\u001F\u007F]/g, "");
  return noCtrls.slice(0, 140);
}

// PATCH /api/tracks/[id]  -> Titel umbenennen
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: PatchBody = {};
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    // ignore; leere body ist invalid
  }

  if (!body.title || body.title.trim().length === 0) {
    return NextResponse.json(
      { error: "INVALID_TITLE", message: "Titel darf nicht leer sein." },
      { status: 400 }
    );
  }

  const title = sanitizeTitle(body.title);

  // Ownership prüfen + Update
  const updated = await prisma.track.update({
    where: { id },
    data: { title },
    select: {
      id: true,
      title: true,
      url: true,
      durationSeconds: true,
      createdAt: true,
      userId: true,
    },
  }).catch(() => null);

  // Falls der Track nicht existiert
  if (!updated) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // Ownership check (zur Sicherheit nach Update-Result)
  if (updated.userId !== session.user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // userId nicht nach außen geben
  const { userId, ...safe } = updated;
  return NextResponse.json(safe);
}

// DELETE /api/tracks/[id] -> Track löschen (DB)
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { id } = await ctx.params;

  // Erst verifizieren, dass der Track dem User gehört
  const track = await prisma.track.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });

  if (!track) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (track.userId !== session.user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  await prisma.track.delete({ where: { id } });

  // 204 No Content
  return new NextResponse(null, { status: 204 });
}