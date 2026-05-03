// prisma/seed.ts
import { prisma } from "../lib/prisma";

async function main() {
  const presets = [
    { slug: "classic-asmr", label: "Classic ASMR (Whisper, Tapping)", defaultDurationSec: 120 },
    { slug: "sleep-story",  label: "Sleep Story (Calm, Slow)",       defaultDurationSec: 600 },
    { slug: "meditation",   label: "Meditation (Breath, Soft Tone)", defaultDurationSec: 300 },
  ];

  for (const p of presets) {
    await prisma.preset.upsert({
      where: { slug: p.slug },
      update: { label: p.label, defaultDurationSec: p.defaultDurationSec },
      create: p,
    });
  }

  console.log("✅ Presets upserted:", presets.map(p => p.slug).join(", "));
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });