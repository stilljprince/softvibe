-- Add language column to Job
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "language" TEXT;

-- Optional: default for existing rows (safe)
UPDATE "Job" SET "language" = 'de' WHERE "language" IS NULL;