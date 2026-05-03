// scripts/normalize-track-titles.cjs
/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/**
 * Titel aus Prompt bauen:
 * - Whitespace normalisieren
 * - auf 80 Zeichen kürzen
 * - Fallback, wenn prompt leer
 */
function makeTitleFromPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") {
   return "SoftVibe Track";
  }

  let t = prompt.replace(/\s+/g, " ").trim();

  if (t.length === 0) {
    return "SoftVibe Track";
  }

  if (t.length > 80) {
    t = t.slice(0, 77) + "…";
  }

  return t;
}

async function main() {
  console.log("▶️  Normalize Track-Titles startet …");

  let totalUpdated = 0;
  let cursor = null;

  while (true) {
    const batch = await prisma.track.findMany({
      where: {
        // Nur Tracks, die einen Job haben – sonst kein Prompt
        job: {
          isNot: null,
        },
      },
      include: {
        job: true,
      },
      orderBy: {
        id: "asc",
      },
      take: 100,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
    });

    if (batch.length === 0) {
      break;
    }

    for (const t of batch) {
      const jobPrompt = t.job?.prompt || "";
      const trackTitle = t.title || "";

      const normalizedPrompt = jobPrompt.replace(/\s+/g, " ").trim();
      const normalizedTitle = trackTitle.replace(/\s+/g, " ").trim();

      // Nur anpassen, wenn Titel 1:1 dem Prompt entspricht
      if (normalizedPrompt.length > 0 && normalizedTitle === normalizedPrompt) {
        const newTitle = makeTitleFromPrompt(jobPrompt);

        if (newTitle !== trackTitle) {
          await prisma.track.update({
            where: { id: t.id },
            data: { title: newTitle },
          });
          totalUpdated++;
          console.log(`  ✏️  Track ${t.id}: Titel aktualisiert`);
        }
      }
    }

    cursor = batch[batch.length - 1].id;
  }

  console.log(`✅ Fertig. Insgesamt aktualisierte Tracks: ${totalUpdated}`);
}

main()
  .catch((err) => {
    console.error("❌ Normalize failed:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });