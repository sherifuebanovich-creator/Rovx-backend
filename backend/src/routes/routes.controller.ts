import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RoutesService } from './routes.service';
import { CalculateRouteDto, SaveRouteDto } from './dto/calculate-route.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Routes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('routes')
export class RoutesController {
  constructor(private routesService: RoutesService) {}

  @Public()
  @Post('calculate')
  @ApiOperation({ summary: 'Calculate route options' })
  async calculate(@Body() dto: CalculateRouteDto, @CurrentUser('id') userId?: string) {
    return this.routesService.calculateRoute(dto, userId || undefined);
  }

  @Post('save')
  @ApiOperation({ summary: 'Save a route' })
  async save(@Body() dto: SaveRouteDto, @CurrentUser('id') userId: string) {
    return this.routesService.saveRoute(dto, userId);
  }

  @Get('saved')
  @ApiOperation({ summary: 'Get saved routes' })
  async getSaved(@CurrentUser('id') userId: string) {
    return this.routesService.getSavedRoutes(userId);
  }

  @Delete('saved/:id')
  @ApiOperation({ summary: 'Delete saved route' })
  async deleteSaved(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.routesService.deleteSavedRoute(id, userId);
  }

  @Get('trips')
  @ApiOperation({ summary: 'Get trip history' })
  async getTrips(
    @CurrentUser('id') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    // Capped like every other bounds-checked list endpoint in the app (see
    // MapController#getObjects) — otherwise a client can pass an arbitrarily
    // large `limit` straight through to the Prisma `take`.
    return this.routesService.getTrips(userId, page, Math.min(limit, 100));
  }

  @Post('trips/start')
  @ApiOperation({ summary: 'Start a trip' })
  async startTrip(@CurrentUser('id') userId: string, @Body() data: any) {
    this.validateTripStart(data);
    return this.routesService.startTrip(userId, data);
  }

  @Post('trips/:id/end')
  @ApiOperation({ summary: 'End a trip' })
  async endTrip(
    @Param('id') tripId: string,
    @CurrentUser('id') userId: string,
    @Body() stats: any,
  ) {
    this.validateTripStats(stats);
    return this.routesService.endTrip(tripId, userId, stats);
  }

  // originLat/originLng/destLat/destLng/destName are non-nullable columns
  // on Trip — unlike every other handler in this controller, this body was
  // passed straight to Prisma with no checks, so a malformed request failed
  // as an unhandled Prisma error (raw 500) instead of a 400.
  private validateTripStart(data: any) {
    if (!data || typeof data !== 'object') throw new BadRequestException('Invalid request body');
    const coords = ['originLat', 'originLng', 'destLat', 'destLng'];
    for (const key of coords) {
      const val = data[key];
      if (typeof val !== 'number' || !isFinite(val)) {
        throw new BadRequestException(`${key} must be a valid number`);
      }
    }
    if (data.originLat < -90 || data.originLat > 90 || data.destLat < -90 || data.destLat > 90) {
      throw new BadRequestException('Latitude must be between -90 and 90');
    }
    if (data.originLng < -180 || data.originLng > 180 || data.destLng < -180 || data.destLng > 180) {
      throw new BadRequestException('Longitude must be between -180 and 180');
    }
    if (typeof data.destName !== 'string' || !data.destName.trim()) {
      throw new BadRequestException('destName is required');
    }
    if (data.duration !== undefined && (typeof data.duration !== 'number' || !Number.isInteger(data.duration) || data.duration < 0)) {
      throw new BadRequestException('duration must be a non-negative integer');
    }
    if (data.distance !== undefined && (typeof data.distance !== 'number' || !isFinite(data.distance) || data.distance < 0)) {
      throw new BadRequestException('distance must be a non-negative number');
    }
  }

  // stats.distance feeds User.totalDistance via an unchecked increment in
  // endTrip — without a non-negative check here a client could send a
  // negative distance to decrement their own totalDistance/leaderboard
  // standing. duration is an Int column, so a non-integer value would
  // otherwise fail as an unhandled Prisma error.
  private validateTripStats(stats: any) {
    if (!stats || typeof stats !== 'object') throw new BadRequestException('Invalid request body');
    const nonNegativeNumbers = ['fuelUsed', 'avgSpeed', 'maxSpeed', 'distance'];
    for (const key of nonNegativeNumbers) {
      const val = stats[key];
      if (val !== undefined && (typeof val !== 'number' || !isFinite(val) || val < 0)) {
        throw new BadRequestException(`${key} must be a non-negative number`);
      }
    }
    if (stats.duration !== undefined && (typeof stats.duration !== 'number' || !Number.isInteger(stats.duration) || stats.duration < 0)) {
      throw new BadRequestException('duration must be a non-negative integer');
    }
  }
}
