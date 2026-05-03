// app/api/playlists/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/playlists — list the authenticated user's playlists
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const rows = await prisma.playlist.findMany({
    where: { userId: session.user.id },
    orderBy: [{ pinned: "desc" }, { position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      pinned: true,
      position: true,
      coverKey: true,
      createdAt: true,
      _count: { select: { items: true } },
    },
  });

  return jsonOk({
    playlists: rows.map((pl) => ({
      id: pl.id,
      name: pl.name,
      pinned: pl.pinned,
      position: pl.position,
      coverKey: pl.coverKey,
      createdAt: pl.createdAt.toISOString(),
      itemCount: pl._count.items,
    })),
  });
}

// POST /api/playlists — create a new playlist
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
  if (!name) return jsonError("Name required", 400);

  // Assign position at the end of the unpinned group
  const maxPos = await prisma.playlist.aggregate({
    where: { userId: session.user.id, pinned: false },
    _max: { position: true },
  });
  const position = (maxPos._max.position ?? -1) + 1;

  const pl = await prisma.playlist.create({
    data: { userId: session.user.id, name, position },
    select: { id: true, name: true, pinned: true, position: true, coverKey: true, createdAt: true },
  });

  return jsonOk(
    { playlist: { id: pl.id, name: pl.name, pinned: pl.pinned, position: pl.position, coverKey: pl.coverKey, createdAt: pl.createdAt.toISOString(), itemCount: 0 } },
    201,
  );
}
