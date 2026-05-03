// app/api/presets/route.ts
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError, requireAuth } from "@/lib/api";

export const runtime = "nodejs";

const FALLBACK_PRESETS = [
  { id: "classic-asmr",  label: "Classic ASMR (Whisper, Tapping)" },
  { id: "sleep-story",   label: "Sleep Story (Calm, Slow)" },
  { id: "meditation",    label: "Meditation (Breath, Soft Tone)" },
  { id: "kids-story",    label: "Kids Story (Gentle, Safe)" },
];

// GET: Presets aus DB, sonst Fallback (all four pillars always present)
export async function GET() {
  try {
    const presets = await prisma.preset.findMany({
      orderBy: { label: "asc" },
    });

    if (presets.length === 0) {
      return jsonOk(FALLBACK_PRESETS, 200);
    }

    return jsonOk(
      presets.map((p) => ({ id: p.slug, label: p.label })),
      200,
    );
  } catch {
    // Fallback if the Preset table doesn't exist yet
    return jsonOk(FALLBACK_PRESETS, 200);
  }
}

// POST: Preset anlegen / updaten — admin only
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return jsonError("UNAUTHORIZED", 401);

  // isAdmin is not stored in the JWT; re-fetch from DB
  const user = await prisma.user.findFirst({
    where: { id: auth.userId },
    select: { isAdmin: true },
  });
  if (!user?.isAdmin) return jsonError("FORBIDDEN", 403);

  const body = await req.json().catch(() => null);
  if (!body || !body.slug || !body.label) {
    return jsonError("slug und label erforderlich", 400);
  }

  const saved = await prisma.preset.upsert({
    where: { slug: body.slug },
    update: { label: body.label },
    create: { slug: body.slug, label: body.label },
  });

  return jsonOk(saved, 201);
}
