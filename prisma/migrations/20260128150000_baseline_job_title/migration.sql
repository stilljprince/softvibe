-- Baseline migration: Job.title was added outside Prisma migrations.
-- We add it here so the migration history matches the real DB schema.
ALTER TABLE "Job" ADD COLUMN "title" TEXT;