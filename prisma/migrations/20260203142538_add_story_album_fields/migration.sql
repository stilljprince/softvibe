/*
  Warnings:

  - You are about to drop the column `partIndex` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `partTitle` on the `Track` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."Track_storyId_partIndex_idx";

-- AlterTable
ALTER TABLE "Track" DROP COLUMN "partIndex",
DROP COLUMN "partTitle",
ADD COLUMN     "chapterIndex" INTEGER;

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "preset" TEXT NOT NULL DEFAULT 'sleep-story',
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Story_userId_createdAt_idx" ON "Story"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Track_storyId_chapterIndex_idx" ON "Track"("storyId", "chapterIndex");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;
