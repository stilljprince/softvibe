// app/api/presets/route.ts
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";

export const runtime = "nodejs";

// GET: Presets aus DB, sonst Fallback
export async function GET() {
  try {
    const presets = await prisma.preset.findMany({
      orderBy: { label: "asc" },
    });

    if (presets.length === 0) {
      return jsonOk(
        [
          { id: "classic-asmr", label: "Classic ASMR (Whisper, Tapping)" },
          { id: "sleep-story", label: "Sleep Story (Calm, Slow)" },
          { id: "meditation", label: "Meditation (Breath, Soft Tone)" },
        ],
        200
      );
    }

    return jsonOk(
      presets.map((p) => ({
        id: p.slug,
        label: p.label,
      })),
      200
    );
  } catch {
    // Fallback, falls Tabelle (noch) nicht vorhanden ist
    return jsonOk(
      [
        { id: "classic-asmr", label: "Classic ASMR (Whisper, Tapping)" },
        { id: "sleep-story", label: "Sleep Story (Calm, Slow)" },
        { id: "meditation", label: "Meditation (Breath, Soft Tone)" },
      ],
      200
    );
  }
}

// POST: Preset anlegen / updaten
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  if (!body || !body.slug || !body.label) {
    return jsonError("slug und label erforderlich", 400);
  }

  const saved = await prisma.preset.upsert({
    where: { slug: body.slug },
    update: { label: body.label },
    create: {
      slug: body.slug,
      label: body.label,
    },
  });

  return jsonOk(saved, 201);
}