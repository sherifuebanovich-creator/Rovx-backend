import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
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
    const cappedLimit = Math.min(limit ? +limit : 200, 500);

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
    return this.mapService.getNearby(+lat, +lng, +radius, category);
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
    return this.mapService.getTrafficInBounds(+minLat, +maxLat, +minLng, +maxLng);
  }

  @Get('speed-cameras')
  @ApiOperation({ summary: 'Get real OSM speed cameras near a point' })
  async getSpeedCameras(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Query('radius') radius = 10,
  ) {
    return this.mapService.getSpeedCameras(+lat, +lng, +radius);
  }

  @Get('traffic-signals')
  @ApiOperation({ summary: 'Get real OSM traffic signal nodes near a point' })
  async getTrafficSignals(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Query('radius') radius = 2,
  ) {
    return this.mapService.getTrafficSignals(+lat, +lng, +radius);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search map objects' })
  async search(
    @Query('q') query: string,
    @Query('lat') lat?: number,
    @Query('lng') lng?: number,
    @Query('radius') radius = 50,
  ) {
    if (!query || query.length > 200) throw new BadRequestException('Query must be 1-200 characters');
    return this.mapService.searchObjects(query.trim(), lat ? +lat : undefined, lng ? +lng : undefined, Math.min(+radius, 100));
  }

  @Get('suggest')
  @ApiOperation({ summary: 'Autocomplete suggestions' })
  async suggest(
    @Query('q') query: string,
    @Query('lat') lat?: number,
    @Query('lng') lng?: number,
  ) {
    if (!query || query.length > 200) throw new BadRequestException('Query must be 1-200 characters');
    return this.mapService.getSuggestions(query.trim(), lat ? +lat : undefined, lng ? +lng : undefined);
  }

  @Get('reverse-geocode')
  @ApiOperation({ summary: 'Reverse geocode coordinates to address' })
  async reverseGeocode(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
  ) {
    return this.mapService.reverseGeocode(+lat, +lng);
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
