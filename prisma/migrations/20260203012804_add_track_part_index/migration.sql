-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "partIndex" INTEGER;

-- CreateIndex
CREATE INDEX "Track_jobId_partIndex_idx" ON "Track"("jobId", "partIndex");
