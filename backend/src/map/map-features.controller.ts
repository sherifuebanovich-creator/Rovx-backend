import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { MapFeaturesSyncService } from './map-features-sync.service';

@ApiTags('map-features')
@Controller('map-features')
export class MapFeaturesController {
  constructor(private readonly syncService: MapFeaturesSyncService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Get map features (cameras, traffic lights) by bounding box' })
  @ApiQuery({ name: 'bbox', required: true, description: 'minLat,minLng,maxLat,maxLng' })
  @ApiQuery({ name: 'types', required: false, description: 'speed_camera,traffic_signals' })
  async getByBbox(
    @Query('bbox') bbox: string,
    @Query('types') types?: string,
  ) {
    if (!bbox) {
      return { success: true, data: [] };
    }

    const parts = bbox.split(',').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      return { success: true, data: [] };
    }

    const [minLat, minLng, maxLat, maxLng] = parts;
    const latSpan = Math.abs(maxLat - minLat);
    const lngSpan = Math.abs(maxLng - minLng);
    if (latSpan > 10 || lngSpan > 10) {
      return { success: true, data: [] };
    }

    const typeList = types ? types.split(',').map(t => t.trim()) : undefined;
    const features = await this.syncService.getFeaturesByBbox(minLat, minLng, maxLat, maxLng, typeList);

    return {
      success: true,
      data: features.map(f => ({
        id: f.id,
        type: f.type,
        lat: f.lat,
        lng: f.lng,
        countryCode: f.countryCode,
        tags: f.tags ? JSON.parse(f.tags) : null,
        updatedAt: f.updatedAt,
      })),
    };
  }

  @Get('stats')
  @Public()
  @ApiOperation({ summary: 'Get map features statistics' })
  async getStats() {
    const stats = await this.syncService.getStats();
    return { success: true, data: stats };
  }

  @Post('sync')
  @Public()
  @ApiOperation({ summary: 'Trigger manual sync (admin use)' })
  async triggerSync() {
    const result = await this.syncService.syncAll();
    return { success: true, data: result };
  }
}
