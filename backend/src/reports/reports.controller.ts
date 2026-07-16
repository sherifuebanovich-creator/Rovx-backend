import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  ParseBoolPipe,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'photos', maxCount: 3 },
      ],
      {
        storage: diskStorage({
          destination: (_req, _file, cb) => {
            const dir = join(process.cwd(), 'uploads', 'reports');
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            cb(null, dir);
          },
          filename: (_req, file, cb) => {
            const uniqueName = `report-${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;
            cb(null, uniqueName);
          },
        }),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
          if (!file.mimetype.match(/^image\/(jpeg|png|webp|gif)$/)) {
            return cb(new BadRequestException('Only JPEG, PNG, WebP, GIF images allowed'), false);
          }
          cb(null, true);
        },
      },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create hazard/event report' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: any,
    @UploadedFiles() files?: { photos?: Express.Multer.File[] },
  ) {
    if (files?.photos?.length) {
      dto.images = files.photos.map(f => `/uploads/reports/${f.filename}`);
    }
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
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new BadRequestException('imageUrl is required');
    }
    // URL/protocol/SSRF/size validation (incl. base64 data: URLs from the
    // client's pre-upload preview) is handled centrally in the service.
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
    @Query('minLat') minLat: string,
    @Query('maxLat') maxLat: string,
    @Query('minLng') minLng: string,
    @Query('maxLng') maxLng: string,
    @Query('types') types?: string,
  ) {
    const nLat = parseFloat(minLat);
    const xLat = parseFloat(maxLat);
    const nLng = parseFloat(minLng);
    const xLng = parseFloat(maxLng);
    if ([nLat, xLat, nLng, xLng].some(isNaN)) {
      return { reports: [], total: 0 };
    }
    const reportTypes = types ? (types.split(',')) : undefined;
    return this.reportsService.getReportsInArea(nLat, xLat, nLng, xLng, reportTypes);
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
