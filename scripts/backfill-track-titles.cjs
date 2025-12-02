/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-undef */
  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/**
 * Aus einem Prompt / Titel einen kurzen, lesbaren Track-Titel machen.
 */
function makeTitleFromPrompt(raw) {
  if (!raw || typeof raw !== "string") return "SoftVibe Track";
  let s = raw.trim();
  if (!s) return "SoftVibe Track";

  // Erste Zeile nehmen (falls \n drin ist)
  const firstLine = s.split("\n")[0].trim();

  // Ein bisschen aufräumen (Anführungszeichen, zu viel Whitespace etc.)
  s = firstLine.replace(/["“”]+/g, "").replace(/\s+/g, " ").trim();

  // Länge begrenzen
  if (s.length > 80) {
    s = s.slice(0, 77) + "…";
  }

  return s || "SoftVibe Track";
}

async function main() {
  console.log("▶️  Backfill Track-Titles startet …");

  const BATCH_SIZE = 100;
  let cursor = null;
  let totalUpdated = 0;

  // Wir bearbeiten nur Tracks, bei denen title noch leer ist
  while (true) {
        const tracks = await prisma.track.findMany({
      where: {
        // title ist in Prisma als String (required) definiert,
        // deshalb dürfen wir nicht nach `null` filtern.
        // Wir nehmen hier nur wirklich leere Strings mit.
        OR: [
          { title: "" },
          { title: " " } // optional: falls irgendwo ein einzelnes Leerzeichen gespeichert wurde
        ]
      },
      take: BATCH_SIZE,
      ...(cursor
        ? {
            skip: 1,
            cursor: { id: cursor },
          }
        : {}),
      include: {
        job: true
      },
      orderBy: {
        id: "asc"
      }
    });

    if (tracks.length === 0) break;

    for (const t of tracks) {
      const jobTitle = t.job?.title || null;
      const jobPrompt = t.job?.prompt || null;

      const source =
        (jobTitle && jobTitle.trim()) ||
        (jobPrompt && jobPrompt.trim()) ||
        "";

      const newTitle = makeTitleFromPrompt(source);

      await prisma.track.update({
        where: { id: t.id },
        data: { title: newTitle },
      });

      totalUpdated += 1;
      console.log(`✅ Track ${t.id} aktualisiert -> "${newTitle}"`);
    }

    cursor = tracks[tracks.length - 1].id;
  }

  console.log(`🎉 Fertig. Insgesamt aktualisierte Tracks: ${totalUpdated}`);
}

main()
  .catch((err) => {
    console.error("❌ Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });



