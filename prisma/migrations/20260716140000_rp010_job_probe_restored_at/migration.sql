-- RP-010 Phase 4A-2: Probe Restoration idempotency marker on Job
--
-- Strictly additive migration. Adds:
--   * Job.probeRestoredAt (nullable timestamp)
--
-- Set exactly once when a terminal PROBE-job failure returns its lifetime
-- slot to User.probeGenerationsUsed. Acts as the CAS-guarded idempotency
-- marker for restoreProbeOnTerminalFailure so a repeated Failure/Recovery
-- call cannot double-restore the counter. Intentionally separate from
-- creditRefundedAt (credits are a different bucket), from usageReleasedAt
-- and usageFinalizedAt (plan-minutes lifecycle) — the probe-slot system
-- must not be conflated with credits or plan minutes.
--
-- No existing columns are dropped, renamed, or rewritten. Existing Jobs
-- remain valid because the new column is nullable; no data backfill.

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "probeRestoredAt" TIMESTAMP(3);
