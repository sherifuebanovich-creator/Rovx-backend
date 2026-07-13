-- AlterTable
ALTER TABLE "speed_cameras" ADD COLUMN "osmId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "speed_cameras_osmId_key" ON "speed_cameras"("osmId");
