-- CreateTable
CREATE TABLE "map_features" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "countryCode" TEXT NOT NULL,
    "osmId" TEXT NOT NULL,
    "tags" TEXT,
    "source" TEXT NOT NULL DEFAULT 'osm',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "map_features_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "map_features_osmId_key" ON "map_features"("osmId");

-- CreateIndex
CREATE INDEX "map_features_lat_lng_idx" ON "map_features"("lat", "lng");

-- CreateIndex
CREATE INDEX "map_features_countryCode_idx" ON "map_features"("countryCode");

-- CreateIndex
CREATE INDEX "map_features_type_idx" ON "map_features"("type");
