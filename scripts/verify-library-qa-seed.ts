// scripts/verify-library-qa-seed.ts
//
// Ad-hoc verification helper — inspects the current state of curated
// Library rows in the connected database, so after running the QA seed
// twice we can independently confirm no duplicates were created and no
// non-QA rows exist.  Read-only.
//
// Run:
//   npx tsx scripts/verify-library-qa-seed.ts

import { prisma } from "../lib/prisma";

async function main(): Promise<void> {
  const qa = await prisma.librarySession.findMany({
    where: { slug: { startsWith: "qa-" } },
    orderBy: { slug: "asc" },
    select: {
      id: true,
      slug: true,
      title: true,
      preset: true,
      isActive: true,
      durationSeconds: true,
      chapters: {
        orderBy: { partIndex: "asc" },
        select: {
          id: true,
          partIndex: true,
          title: true,
          durationSeconds: true,
          audioKey: true,
        },
      },
    },
  });

  const nonQa = await prisma.librarySession.count({
    where: { slug: { not: { startsWith: "qa-" } } },
  });

  const totalActive = await prisma.librarySession.count({
    where: { isActive: true },
  });

  console.log("");
  console.log(`QA LibrarySession rows: ${qa.length}`);
  console.log(`Non-QA LibrarySession rows: ${nonQa}`);
  console.log(`Total ACTIVE LibrarySession rows: ${totalActive}`);
  console.log("");
  for (const s of qa) {
    console.log(
      `• ${s.slug}  id=${s.id}  preset=${s.preset}  active=${s.isActive}  chapters=${s.chapters.length}`
    );
    for (const c of s.chapters) {
      console.log(
        `    part[${c.partIndex}]  id=${c.id}  audioKey=${c.audioKey}`
      );
    }
  }
  console.log("");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
