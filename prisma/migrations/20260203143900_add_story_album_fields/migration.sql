/*
  Warnings:

  - You are about to drop the column `chapterIndex` on the `Track` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[storyId,partIndex]` on the table `Track` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "public"."Track" DROP CONSTRAINT "Track_storyId_fkey";

-- DropIndex
DROP INDEX "public"."Track_storyId_chapterIndex_idx";

-- AlterTable
ALTER TABLE "Track" DROP COLUMN "chapterIndex",
ADD COLUMN     "partIndex" INTEGER;

-- CreateIndex
CREATE INDEX "Track_storyId_partIndex_idx" ON "Track"("storyId", "partIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Track_storyId_partIndex_key" ON "Track"("storyId", "partIndex");

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
