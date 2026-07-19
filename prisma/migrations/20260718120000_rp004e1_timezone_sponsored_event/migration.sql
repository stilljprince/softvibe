-- RP-004E1: Curated Library & Simulated Sponsored Unlock Foundation.
--
-- Strictly additive migration. Adds:
--   * User.timezone (nullable IANA timezone captured on first browser sample)
--   * SponsoredUnlockProvider enum (SIMULATED_SOFTVIBE only in E1)
--   * SponsoredUnlockEventStatus enum
--     (PENDING / COMPLETED / CONSUMED / EXPIRED / CANCELLED)
--   * SponsoredUnlockEvent table
--
-- Nothing is dropped, renamed, or updated. No existing row is touched.
-- No existing LibraryUnlock, User, LibrarySession, LibrarySessionChapter,
-- Job, PeriodUsage, Track, Story, Playlist, PlaylistItem or Preset row
-- is modified in any way. Existing users keep timezone = NULL and the
-- unlock code falls back to UTC for that case.

-- AlterTable: User — add nullable timezone column.
-- NULL is the DEFAULT for existing rows; no backfill.
ALTER TABLE "User" ADD COLUMN "timezone" TEXT;

-- CreateEnum: SponsoredUnlockProvider
CREATE TYPE "SponsoredUnlockProvider" AS ENUM ('SIMULATED_SOFTVIBE');

-- CreateEnum: SponsoredUnlockEventStatus
CREATE TYPE "SponsoredUnlockEventStatus" AS ENUM ('PENDING', 'COMPLETED', 'CONSUMED', 'EXPIRED', 'CANCELLED');

-- CreateTable: SponsoredUnlockEvent
CREATE TABLE "SponsoredUnlockEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "librarySessionId" TEXT NOT NULL,
    "provider" "SponsoredUnlockProvider" NOT NULL,
    "status" "SponsoredUnlockEventStatus" NOT NULL DEFAULT 'PENDING',
    "providerEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eligibleAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "SponsoredUnlockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SponsoredUnlockEvent_providerEventId_key" ON "SponsoredUnlockEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "SponsoredUnlockEvent_userId_librarySessionId_status_idx" ON "SponsoredUnlockEvent"("userId", "librarySessionId", "status");

-- CreateIndex
CREATE INDEX "SponsoredUnlockEvent_userId_createdAt_idx" ON "SponsoredUnlockEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SponsoredUnlockEvent_expiresAt_idx" ON "SponsoredUnlockEvent"("expiresAt");

-- AddForeignKey
ALTER TABLE "SponsoredUnlockEvent" ADD CONSTRAINT "SponsoredUnlockEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsoredUnlockEvent" ADD CONSTRAINT "SponsoredUnlockEvent_librarySessionId_fkey" FOREIGN KEY ("librarySessionId") REFERENCES "LibrarySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
