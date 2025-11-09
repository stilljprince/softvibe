// app/api/tracks/[id]/share/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Body = {
  isPublic?: boolean;
};

function makeSlug(len = 10) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // ignore
  }

  const track = await prisma.track.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, isPublic: true, shareSlug: true },
  });
  if (!track) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const wantPublic = !!body.isPublic;

  if (wantPublic) {
    let slug = track.shareSlug ?? makeSlug(10);
    // falls Kollision (sehr unwahrscheinlich), neu würfeln
    // (Kleine Schleife, max. 5 Versuche)
    for (let i = 0; i < 5; i++) {
      const clash = await prisma.track.findUnique({ where: { shareSlug: slug } });
      if (!clash || clash.id === track.id) break;
      slug = makeSlug(10);
    }

    const updated = await prisma.track.update({
      where: { id },
      data: { isPublic: true, shareSlug: slug },
      select: { id: true, isPublic: true, shareSlug: true },
    });
    return NextResponse.json(updated);
  } else {
    const updated = await prisma.track.update({
      where: { id },
      data: { isPublic: false, shareSlug: null },
      select: { id: true, isPublic: true, shareSlug: true },
    });
    return NextResponse.json(updated);
  }
}