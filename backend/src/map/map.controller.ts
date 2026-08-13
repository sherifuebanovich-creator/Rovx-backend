import { Controller, Get, Post, Delete, Body, Param, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MapService } from './map.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
const MapObjectCategory = {
  GAS_STATION: 'GAS_STATION',
  EV_CHARGER: 'EV_CHARGER',
  PARKING: 'PARKING',
  TRUCK_PARKING: 'TRUCK_PARKING',
  CAFE: 'CAFE',
  RESTAURANT: 'RESTAURANT',
  HOTEL: 'HOTEL',
  MOTEL: 'MOTEL',
  TOILET: 'TOILET',
  SHOWER: 'SHOWER',
  PHARMACY: 'PHARMACY',
  HOSPITAL: 'HOSPITAL',
  MEDICAL: 'MEDICAL',
  SHOP: 'SHOP',
  SUPERMARKET: 'SUPERMARKET',
  MALL: 'MALL',
  SCHOOL: 'SCHOOL',
  UNIVERSITY: 'UNIVERSITY',
  KINDERGARTEN: 'KINDERGARTEN',
  BANK: 'BANK',
  ATM: 'ATM',
  BUS_STOP: 'BUS_STOP',
  METRO_STATION: 'METRO_STATION',
  TRAIN_STATION: 'TRAIN_STATION',
  AIRPORT: 'AIRPORT',
  PARK: 'PARK',
  SPORTS_FACILITY: 'SPORTS_FACILITY',
  GOVERNMENT: 'GOVERNMENT',
  ATTRACTION: 'ATTRACTION',
  TIRE_SERVICE: 'TIRE_SERVICE',
  CAR_SERVICE: 'CAR_SERVICE',
  CAR_WASH: 'CAR_WASH',
  WEIGH_STATION: 'WEIGH_STATION',
  BORDER_CROSSING: 'BORDER_CROSSING',
  CUSTOMS: 'CUSTOMS',
  REST_AREA: 'REST_AREA',
  TOURIST_ATTRACTION: 'TOURIST_ATTRACTION',
  SPEED_CAMERA: 'SPEED_CAMERA',
  ROAD_WORKS: 'ROAD_WORKS',
  ACCIDENT: 'ACCIDENT',
  TRAFFIC_LIGHT: 'TRAFFIC_LIGHT',
  POLICE: 'POLICE',
} as const;
type MapObjectCategory = (typeof MapObjectCategory)[keyof typeof MapObjectCategory];

@ApiTags('Map')
@Controller('map')
export class MapController {
  constructor(private mapService: MapService) {}

  @Get('objects')
  @ApiOperation({ summary: 'Get map objects in bounds' })
  async getObjects(
    @Query('minLat') minLat: number,
    @Query('maxLat') maxLat: number,
    @Query('minLng') minLng: number,
    @Query('maxLng') maxLng: number,
    @Query('categories') categories?: string,
    @Query('limit') limit?: number,
  ) {
    const nMinLat = +minLat, nMaxLat = +maxLat, nMinLng = +minLng, nMaxLng = +maxLng;
    if ([nMinLat, nMaxLat, nMinLng, nMaxLng].some(v => !isFinite(v))) {
      throw new BadRequestException('Invalid coordinates');
    }
    if (nMinLat < -90 || nMaxLat > 90 || nMinLng < -180 || nMaxLng > 180) {
      throw new BadRequestException('Coordinates out of range');
    }
    if (nMinLat >= nMaxLat || nMinLng >= nMaxLng) {
      throw new BadRequestException('minLat must be less than maxLat, minLng less than maxLng');
    }
    const latSpan = nMaxLat - nMinLat;
    const lngSpan = nMaxLng - nMinLng;
    if (latSpan > 10 || lngSpan > 10) {
      throw new BadRequestException('Bounding box too large (max 10° per axis)');
    }

    const cats = categories
      ? (categories.split(',') as MapObjectCategory[])
      : undefined;
    // A non-numeric limit (e.g. "abc") made `+limit` NaN, which survived
    // Math.min(NaN, 500) as NaN and was then passed straight through as
    // Prisma's `take: NaN`. A negative limit similarly passed through
    // unclamped. Both are guarded against here the same way the coordinate
    // params above are.
    const rawLimit = limit !== undefined ? +limit : 200;
    const cappedLimit = Math.min(Math.max(isFinite(rawLimit) ? rawLimit : 200, 1), 500);

    return this.mapService.getObjectsInBounds({
      minLat: nMinLat,
      maxLat: nMaxLat,
      minLng: nMinLng,
      maxLng: nMaxLng,
      categories: cats,
      limit: cappedLimit,
    });
  }

  @Get('nearby')
  @ApiOperation({ summary: 'Get nearby objects' })
  async getNearby(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Query('radius') radius = 5,
    @Query('category') category?: MapObjectCategory,
  ) {
    const nLat = +lat, nLng = +lng, nRadius = +radius;
    // Unlike getObjects/getTraffic/getSpeedCameras/getTrafficSignals, this had
    // no coordinate/radius validation at all — a non-numeric or out-of-range
    // lat/lng propagates as NaN into the bbox math and then into Prisma's
    // gte/lte filters, and an unclamped radius is only incidentally bounded
    // by the lat/lng clamping downstream, not validated here.
    if (![nLat, nLng, nRadius].every(isFinite)) throw new BadRequestException('Invalid coordinates');
    if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) throw new BadRequestException('Coordinates out of range');
    return this.mapService.getNearby(nLat, nLng, Math.min(Math.max(nRadius, 0.1), 100), category);
  }

  @Get('objects/:id')
  @ApiOperation({ summary: 'Get map object details' })
  async getObject(@Param('id') id: string) {
    return this.mapService.getObjectById(id);
  }

  @Get('traffic')
  @ApiOperation({ summary: 'Get traffic data' })
  async getTraffic(
    @Query('minLat') minLat: number,
    @Query('maxLat') maxLat: number,
    @Query('minLng') minLng: number,
    @Query('maxLng') maxLng: number,
  ) {
    const nMinLat = +minLat, nMaxLat = +maxLat, nMinLng = +minLng, nMaxLng = +maxLng;
    if ([nMinLat, nMaxLat, nMinLng, nMaxLng].some(v => !isFinite(v))) {
      throw new BadRequestException('Invalid coordinates');
    }
    if (nMinLat < -90 || nMaxLat > 90 || nMinLng < -180 || nMaxLng > 180) {
      throw new BadRequestException('Coordinates out of range');
    }
    if (nMinLat >= nMaxLat || nMinLng >= nMaxLng) {
      throw new BadRequestException('minLat must be less than maxLat, minLng less than maxLng');
    }
    if (nMaxLat - nMinLat > 10 || nMaxLng - nMinLng > 10) {
      throw new BadRequestException('Bounding box too large (max 10° per axis)');
    }
    return this.mapService.getTrafficInBounds(nMinLat, nMaxLat, nMinLng, nMaxLng);
  }

  @Get('traffic-incidents')
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get live traffic jam incidents (TomTom, proxied server-side)' })
  async getTrafficIncidents(
    @Query('minLng') minLng: number,
    @Query('minLat') minLat: number,
    @Query('maxLng') maxLng: number,
    @Query('maxLat') maxLat: number,
  ) {
    const nMinLng = +minLng, nMinLat = +minLat, nMaxLng = +maxLng, nMaxLat = +maxLat;
    if ([nMinLng, nMinLat, nMaxLng, nMaxLat].some(v => !isFinite(v))) {
      throw new BadRequestException('Invalid coordinates');
    }
    if (nMinLat < -90 || nMaxLat > 90 || nMinLng < -180 || nMaxLng > 180) {
      throw new BadRequestException('Coordinates out of range');
    }
    if (nMinLat >= nMaxLat || nMinLng >= nMaxLng) {
      throw new BadRequestException('minLat must be less than maxLat, minLng less than maxLng');
    }
    if (nMaxLat - nMinLat > 10 || nMaxLng - nMinLng > 10) {
      throw new BadRequestException('Bounding box too large (max 10° per axis)');
    }
    return this.mapService.getTrafficIncidents(nMinLng, nMinLat, nMaxLng, nMaxLat);
  }

  @Get('speed-cameras')
  @ApiOperation({ summary: 'Get real OSM speed cameras near a point' })
  async getSpeedCameras(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Query('radius') radius = 10,
  ) {
    const nLat = +lat, nLng = +lng, nRadius = +radius;
    if (![nLat, nLng, nRadius].every(isFinite)) throw new BadRequestException('Invalid coordinates');
    if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) throw new BadRequestException('Coordinates out of range');
    // Unlike getObjects/getTraffic, this had no radius cap at all — the
    // resulting bbox feeds an uncapped findMany in the service, so an
    // absurd/negative radius could scan (and return) the entire table.
    return this.mapService.getSpeedCameras(nLat, nLng, Math.min(Math.max(nRadius, 0.1), 100));
  }

  @Get('traffic-signals')
  @ApiOperation({ summary: 'Get real OSM traffic signal nodes near a point' })
  async getTrafficSignals(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Query('radius') radius = 2,
  ) {
    const nLat = +lat, nLng = +lng, nRadius = +radius;
    if (![nLat, nLng, nRadius].every(isFinite)) throw new BadRequestException('Invalid coordinates');
    if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) throw new BadRequestException('Coordinates out of range');
    return this.mapService.getTrafficSignals(nLat, nLng, Math.min(Math.max(nRadius, 0.1), 100));
  }

  @Get('search')
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Search map objects' })
  async search(
    @Req() req: Request,
    @Query('q') query: string,
    @Query('lat') lat?: number,
    @Query('lng') lng?: number,
    @Query('radius') radius = 50,
  ) {
    if (!query || query.length > 200) throw new BadRequestException('Query must be 1-200 characters');
    return this.mapService.searchObjects(query.trim(), lat ? +lat : undefined, lng ? +lng : undefined, Math.min(+radius, 100), req.ip);
  }

  @Get('suggest')
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Autocomplete suggestions' })
  async suggest(
    @Req() req: Request,
    @Query('q') query: string,
    @Query('lat') lat?: number,
    @Query('lng') lng?: number,
  ) {
    if (!query || query.length > 200) throw new BadRequestException('Query must be 1-200 characters');
    return this.mapService.getSuggestions(query.trim(), lat ? +lat : undefined, lng ? +lng : undefined, req.ip);
  }

  @Get('reverse-geocode')
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Reverse geocode coordinates to address' })
  async reverseGeocode(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
  ) {
    // Was passing raw +lat/+lng straight through with no validation — a
    // non-numeric value became NaN in the cache key and in Prisma's gte/lte
    // filters below, unlike every other coordinate-taking endpoint in this
    // controller which validates first.
    const nLat = +lat, nLng = +lng;
    if (![nLat, nLng].every(isFinite)) throw new BadRequestException('Invalid coordinates');
    if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) throw new BadRequestException('Coordinates out of range');
    return this.mapService.reverseGeocode(nLat, nLng);
  }

  @Post('bookmarks')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add bookmark' })
  async addBookmark(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.mapService.addBookmark(userId, data);
  }

  @Get('bookmarks')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user bookmarks' })
  async getBookmarks(@CurrentUser('id') userId: string) {
    return this.mapService.getBookmarks(userId);
  }

  @Delete('bookmarks/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete bookmark' })
  async deleteBookmark(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.mapService.deleteBookmark(id, userId);
  }
}
