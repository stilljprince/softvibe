-- DropIndex
DROP INDEX "public"."Track_jobId_partIndex_idx";

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "partTitle" TEXT,
ADD COLUMN     "storyId" TEXT;

-- CreateIndex
CREATE INDEX "Track_storyId_partIndex_idx" ON "Track"("storyId", "partIndex");
