import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseBoolPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
const ReportType = {
  ACCIDENT: 'ACCIDENT',
  ROAD_CLOSURE: 'ROAD_CLOSURE',
  ROAD_WORKS: 'ROAD_WORKS',
  TRAFFIC_JAM: 'TRAFFIC_JAM',
  ICE: 'ICE',
  FOG: 'FOG',
  FLOODING: 'FLOODING',
  POLICE: 'POLICE',
  POTHOLE: 'POTHOLE',
  BAD_ROAD: 'BAD_ROAD',
  STRONG_WIND: 'STRONG_WIND',
  FREQUENT_ACCIDENTS: 'FREQUENT_ACCIDENTS',
  LANDSLIDE: 'LANDSLIDE',
  LOW_BRIDGE: 'LOW_BRIDGE',
  SHARP_TURN: 'SHARP_TURN',
  STEEP_CLIMB: 'STEEP_CLIMB',
  STEEP_DESCENT: 'STEEP_DESCENT',
  WEIGHT_LIMIT: 'WEIGHT_LIMIT',
  HEIGHT_LIMIT: 'HEIGHT_LIMIT',
  LENGTH_LIMIT: 'LENGTH_LIMIT',
  SPEED_CAMERA: 'SPEED_CAMERA',
  HAZARD: 'HAZARD',
  OTHER: 'OTHER',
} as const;
type ReportType = (typeof ReportType)[keyof typeof ReportType];

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create hazard/event report' })
  async create(@CurrentUser('id') userId: string, @Body() dto: any) {
    return this.reportsService.createReport(userId, dto);
  }

  @Post('validate-photo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate photo matches the report type/description using AI' })
  async validatePhoto(
    @Body('imageUrl') imageUrl: string,
    @Body('reportType') reportType?: string,
    @Body('description') description?: string,
  ) {
    return this.reportsService.validatePhoto(imageUrl, reportType, description);
  }

  @Get('limit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user report limit usage' })
  async getLimit(@CurrentUser('id') userId: string) {
    return this.reportsService.getUserReportLimit(userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get reports in area' })
  async getInArea(
    @Query('minLat') minLat: number,
    @Query('maxLat') maxLat: number,
    @Query('minLng') minLng: number,
    @Query('maxLng') maxLng: number,
    @Query('types') types?: string,
  ) {
    const reportTypes = types ? (types.split(',') as ReportType[]) : undefined;
    return this.reportsService.getReportsInArea(+minLat, +maxLat, +minLng, +maxLng, reportTypes);
  }

  @Get('city/:cityName')
  @ApiOperation({ summary: 'Get reports for a specific city' })
  async getForCity(
    @Param('cityName') city: string,
    @Query('page') page = 1,
  ) {
    return this.reportsService.getReportsForCity(city, +page);
  }

  @Post(':id/vote')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm or reject a report' })
  async vote(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body('confirm') confirm: boolean,
  ) {
    return this.reportsService.voteReport(id, userId, confirm);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a report' })
  async delete(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.reportsService.deleteReport(id, userId, role);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my reports' })
  async getMy(
    @CurrentUser('id') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.reportsService.getReportsByUser(userId, +page, +limit);
  }
}
