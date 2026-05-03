// scripts/backfill-track-titles.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Gleiche Logik wie im Frontend, aber nur auf Prompt / alte Titel angewendet
function makeTitleFromPrompt(src: string | null | undefined): string {
  const base = (src ?? "").replace(/\s+/g, " ").trim();
  if (!base) return "SoftVibe Track";

  // Optional: ersten Satz/Fragment bisschen „knacken“
  let out = base;
  if (out.length > 80) {
    out = out.slice(0, 77) + "…";
  }
  return out;
}

async function main() {
  console.log("🔧 Starte Backfill für Track-Titel …");

  // Wir holen alle Tracks inkl. Job, um ggf. aus Job.prompt etwas basteln zu können
  const tracks = await prisma.track.findMany({
    include: {
      job: {
        select: {
          title: true,
          prompt: true,
        },
      },
    },
  });

  let changed = 0;

  for (const t of tracks) {
    const currentTitle = (t.title ?? "").trim();

    // Wenn schon ein kurzer, brauchbarer Titel drin ist, nichts machen
    if (currentTitle && currentTitle.length <= 80) {
      continue;
    }

    // Quelle für neuen Titel: bevorzugt Job.title, sonst Job.prompt, sonst bisheriger Titel
    const source =
      (t.job?.title ?? "").trim() ||
      (t.job?.prompt ?? "").trim() ||
      currentTitle ||
      null;

    const nextTitle = makeTitleFromPrompt(source);

    // Wenn sich nichts ändert, spare das Update
    if (!nextTitle || nextTitle === t.title) continue;

    await prisma.track.update({
      where: { id: t.id },
      data: { title: nextTitle },
    });

    changed++;
  }

  console.log(`✅ Fertig. Aktualisierte Tracks: ${changed}`);
}

main()
  .catch((err) => {
    console.error("❌ Fehler im Backfill-Script:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });