-- DropIndex
DROP INDEX "Playlist_userId_createdAt_idx";

-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Playlist_userId_pinned_position_idx" ON "Playlist"("userId", "pinned", "position");
