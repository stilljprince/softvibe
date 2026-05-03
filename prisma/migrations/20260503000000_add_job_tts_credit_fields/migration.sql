-- AlterTable: add TTS audit + credit-refund idempotency columns to Job
-- Both columns are nullable; existing rows default to NULL (no impact on live data).
ALTER TABLE "Job" ADD COLUMN     "ttsStartedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN     "creditRefundedAt" TIMESTAMP(3);
