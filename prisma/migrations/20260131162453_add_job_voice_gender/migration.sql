/*
  Warnings:

  - You are about to drop the column `voiceVariant` on the `Job` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Job" DROP COLUMN "voiceVariant",
ADD COLUMN     "voiceGender" TEXT NOT NULL DEFAULT 'female',
ADD COLUMN     "voiceStyle" TEXT NOT NULL DEFAULT 'soft';
