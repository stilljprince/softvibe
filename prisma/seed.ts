// prisma/seed.ts
import { prisma } from "../lib/prisma";

async function main() {
  const base = [
    { slug: "classic-asmr", label: "Classic ASMR (Whisper, Tapping)" },
    { slug: "sleep-story", label: "Sleep Story (Calm, Slow)" },
    { slug: "meditation", label: "Meditation (Breath, Soft Tone)" },
  ];

  for (const p of base) {
    await prisma.preset.upsert({
      where: { slug: p.slug },
      update: { label: p.label }, // nur label, kein defaultDurationSec
      create: p,
    });
  }
}

main()
  .then(() => {
    console.log("Seed done");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });