// scripts/backfill-job-titles.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function makeTitle(prompt: string | null): string {
  const base = (prompt ?? "").trim();
  if (!base) return "SoftVibe Track";
  return base.length > 80 ? base.slice(0, 77) + "…" : base;
}

async function main() {
  console.log("Backfill Job.title ...");

  const jobs = await prisma.job.findMany({
    where: {
      OR: [
        { title: null },
        { title: "" },
      ],
    },
    select: {
      id: true,
      prompt: true,
    },
  });

  console.log(`Found ${jobs.length} jobs without title.`);

  for (const job of jobs) {
    const title = makeTitle(job.prompt);
    await prisma.job.update({
      where: { id: job.id },
      data: { title },
    });
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });