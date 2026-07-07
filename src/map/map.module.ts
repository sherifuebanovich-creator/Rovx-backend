import { Module } from '@nestjs/common';
import { MapController } from './map.controller';
import { MapService } from './map.service';
import { GovernmentDataService } from './government-data.service';

@Module({
  controllers: [MapController],
  providers: [MapService, GovernmentDataService],
  exports: [MapService, GovernmentDataService],
})
export class MapModule {}
