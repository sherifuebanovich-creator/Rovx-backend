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
    return this.routesService.calculateRoute(dto, userId);
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
    return this.routesService.getTrips(userId, page, limit);
  }

  @Post('trips/start')
  @ApiOperation({ summary: 'Start a trip' })
  async startTrip(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.routesService.startTrip(userId, data);
  }

  @Post('trips/:id/end')
  @ApiOperation({ summary: 'End a trip' })
  async endTrip(
    @Param('id') tripId: string,
    @CurrentUser('id') userId: string,
    @Body() stats: any,
  ) {
    return this.routesService.endTrip(tripId, userId, stats);
  }
}
