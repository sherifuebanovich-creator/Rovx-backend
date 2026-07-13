import { Module } from '@nestjs/common';
import { MapFeaturesSyncService } from './map-features-sync.service';
import { MapFeaturesController } from './map-features.controller';

@Module({
  controllers: [MapFeaturesController],
  providers: [MapFeaturesSyncService],
  exports: [MapFeaturesSyncService],
})
export class MapFeaturesModule {}
