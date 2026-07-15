-- RP-010 Phase 2A: Curated Library Schema Foundation
--
-- Strictly additive migration. Adds:
--   * LibraryUnlockSource enum (SPONSORED only)
--   * LibrarySession table (independent curated root entity)
--   * LibrarySessionChapter table (ordered chapters, cascades from LibrarySession)
--   * LibraryUnlock table (per-user, per-session unlock; cascades from User and LibrarySession)
--
-- Nothing is dropped, renamed, or updated. No existing rows are touched.
-- No runtime code reads or writes these tables yet — enforcement (daily
-- unlock limits, 8-hour active-unlock reuse, Sponsored Verification) lands
-- in later phases.

-- CreateEnum
CREATE TYPE "LibraryUnlockSource" AS ENUM ('SPONSORED');

-- CreateTable
CREATE TABLE "LibrarySession" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "preset" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibrarySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibrarySessionChapter" (
    "id" TEXT NOT NULL,
    "librarySessionId" TEXT NOT NULL,
    "partIndex" INTEGER NOT NULL,
    "title" TEXT,
    "audioKey" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibrarySessionChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryUnlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "librarySessionId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "source" "LibraryUnlockSource" NOT NULL,
    "providerEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LibrarySession_slug_key" ON "LibrarySession"("slug");

-- CreateIndex
CREATE INDEX "LibrarySession_isActive_idx" ON "LibrarySession"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LibrarySessionChapter_librarySessionId_partIndex_key" ON "LibrarySessionChapter"("librarySessionId", "partIndex");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryUnlock_providerEventId_key" ON "LibraryUnlock"("providerEventId");

-- CreateIndex
CREATE INDEX "LibraryUnlock_userId_unlockedAt_idx" ON "LibraryUnlock"("userId", "unlockedAt");

-- CreateIndex
CREATE INDEX "LibraryUnlock_userId_librarySessionId_expiresAt_idx" ON "LibraryUnlock"("userId", "librarySessionId", "expiresAt");

-- AddForeignKey
ALTER TABLE "LibrarySessionChapter" ADD CONSTRAINT "LibrarySessionChapter_librarySessionId_fkey" FOREIGN KEY ("librarySessionId") REFERENCES "LibrarySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryUnlock" ADD CONSTRAINT "LibraryUnlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryUnlock" ADD CONSTRAINT "LibraryUnlock_librarySessionId_fkey" FOREIGN KEY ("librarySessionId") REFERENCES "LibrarySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
