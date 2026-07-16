-- RP-010 Phase 3B: stable PeriodUsage mapping on Job
--
-- Strictly additive migration. Adds:
--   * Job.periodUsageId (nullable FK to PeriodUsage)
--   * Backing index on Job.periodUsageId
--   * Foreign key with ON DELETE SET NULL so the Job row outlives any
--     accidental PeriodUsage deletion
--
-- No existing columns are dropped, renamed, or rewritten. Existing Jobs
-- remain valid because the new column is nullable; no data backfill.
-- Phase 3B runtime code (finalization) reads this column to locate the
-- PeriodUsage that was debited at reservation time — decoupling finalize
-- from the caller's *current* billing period.

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "periodUsageId" TEXT;

-- CreateIndex
CREATE INDEX "Job_periodUsageId_idx" ON "Job"("periodUsageId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_periodUsageId_fkey" FOREIGN KEY ("periodUsageId") REFERENCES "PeriodUsage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
