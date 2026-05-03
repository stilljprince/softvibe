/*
  Warnings:

  - You are about to drop the column `attempts` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `completedAt` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `startedAt` on the `Job` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[shareSlug]` on the table `Track` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Job" DROP COLUMN "attempts",
DROP COLUMN "completedAt",
DROP COLUMN "startedAt";

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shareSlug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Track_shareSlug_key" ON "Track"("shareSlug");
