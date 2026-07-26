-- CreateTable
CREATE TABLE "voice_rooms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxParticipants" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_rooms_isActive_idx" ON "voice_rooms"("isActive");

-- AddForeignKey
ALTER TABLE "voice_rooms" ADD CONSTRAINT "voice_rooms_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
