import { Controller, Get, Post, Query, Param, Body, UseGuards, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/current-user.decorator';
import { USER_ROLES } from '../common/constants/roles';
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
    // NOTE: the global TransformInterceptor (see main.ts) already wraps every
    // controller return value as { success, data, timestamp }. Manually
    // building that same shape here double-wrapped the payload into
    // { success, data: { success, data: [...] } }, which silently broke
    // every consumer expecting the standard single-wrapped shape (e.g. the
    // frontend's MapFeaturesLayer reads res.data.data and got the inner
    // wrapper object instead of the feature array). Just return the raw data.
    if (!bbox) {
      return [];
    }

    const parts = bbox.split(',').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      return [];
    }

    const [minLat, minLng, maxLat, maxLng] = parts;
    const latSpan = Math.abs(maxLat - minLat);
    const lngSpan = Math.abs(maxLng - minLng);
    if (latSpan > 10 || lngSpan > 10) {
      return [];
    }

    const typeList = types ? types.split(',').map(t => t.trim()) : undefined;
    const features = await this.syncService.getFeaturesByBbox(minLat, minLng, maxLat, maxLng, typeList);

    return features.map(f => ({
      id: f.id,
      type: f.type,
      lat: f.lat,
      lng: f.lng,
      countryCode: f.countryCode,
      tags: f.tags ? JSON.parse(f.tags) : null,
      updatedAt: f.updatedAt,
    }));
  }

  @Get('stats')
  @Public()
  @ApiOperation({ summary: 'Get map features statistics' })
  async getStats() {
    try {
      return await this.syncService.getStats();
    } catch {
      return { total: 0, byType: {}, byCountry: {} };
    }
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(USER_ROLES.ADMIN)
  @ApiOperation({ summary: 'Trigger full sync of all CIS countries (admin only)' })
  async triggerSync() {
    try {
      return await this.syncService.syncAll();
    } catch (err) {
      // Thrown instead of returned as a 200 { success: false } body, so this
      // goes through the global HttpExceptionFilter and matches the same
      // error shape every other endpoint in the API produces.
      throw new InternalServerErrorException((err as Error).message);
    }
  }

  @Post('sync/:country')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(USER_ROLES.ADMIN)
  @ApiOperation({ summary: 'Sync a single country by ISO code (admin only)' })
  async triggerSyncCountry(@Param('country') country: string) {
    const code = country.toUpperCase().trim();
    // Must be exactly 2 alphabetic characters — this value is interpolated
    // into an Overpass QL query string, so anything beyond `length === 2`
    // (e.g. a quote + bracket) can break out of the quoted filter.
    if (!/^[A-Z]{2}$/.test(code)) {
      throw new BadRequestException('Country must be a 2-letter ISO code (e.g. UZ, KZ)');
    }
    try {
      const count = await this.syncService.syncCountry(code);
      return { country: code, count };
    } catch (err) {
      throw new InternalServerErrorException((err as Error).message);
    }
  }

  @Post('import')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(USER_ROLES.ADMIN)
  @ApiOperation({ summary: 'Bulk import Overpass elements (admin only)' })
  async importElements(
    @Body() body: { countryCode: string; elements: Array<{ type: string; id: number; lat: number; lon: number; tags?: Record<string, string> }> },
  ) {
    if (!body.countryCode || body.countryCode.length !== 2) {
      throw new BadRequestException('countryCode must be a 2-letter ISO code');
    }
    if (!Array.isArray(body.elements) || body.elements.length === 0) {
      throw new BadRequestException('elements must be a non-empty array');
    }
    try {
      const count = await this.syncService.importElements(body.elements, body.countryCode.toUpperCase());
      return { country: body.countryCode.toUpperCase(), imported: count };
    } catch (err) {
      throw new InternalServerErrorException((err as Error).message);
    }
  }
}
