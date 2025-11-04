// app/api/presets/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const presets = await prisma.preset.findMany({
      orderBy: { label: "asc" },
    });

    if (presets.length === 0) {
      return NextResponse.json([
        { id: "classic-asmr", label: "Classic ASMR (Whisper, Tapping)" },
        { id: "sleep-story", label: "Sleep Story (Calm, Slow)" },
        { id: "meditation", label: "Meditation (Breath, Soft Tone)" },
      ]);
    }

    return NextResponse.json(
      presets.map((p) => ({
        id: p.slug,
        label: p.label,
      }))
    );
  } catch {
    // Fallback, wenn Tabelle nicht da ist
    return NextResponse.json([
      { id: "classic-asmr", label: "Classic ASMR (Whisper, Tapping)" },
      { id: "sleep-story", label: "Sleep Story (Calm, Slow)" },
      { id: "meditation", label: "Meditation (Breath, Soft Tone)" },
    ]);
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  if (!body || !body.slug || !body.label) {
    return NextResponse.json(
      { error: "slug und label erforderlich" },
      { status: 400 }
    );
  }

  const saved = await prisma.preset.upsert({
    where: { slug: body.slug },
    update: { label: body.label },
    create: {
      slug: body.slug,
      label: body.label,
    },
  });

  return NextResponse.json(saved, { status: 201 });
}