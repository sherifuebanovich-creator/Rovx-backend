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
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// Maps the whitelisted upload mimetypes (see fileFilter below) to safe
// on-disk extensions — never derives the filename extension from the
// client-supplied originalname (see the filename callback comment).
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

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
            // The extension used to be taken from `file.originalname` — a
            // client-supplied multipart field that never matches the file's
            // real content (mimetype is also client-declared, see
            // fileFilter). A request with originalname "evil.html" + declared
            // mimetype "image/png" was stored as .../report-….html and then
            // served by useStaticAssets with Content-Type: text/html on the
            // API origin (helmet CSP is off) — a stored-XSS/phishing surface.
            // Derive the extension from the whitelisted mimetype instead;
            // the declared mimetype still isn't magic-byte-verified, but the
            // stored file can no longer be named to a script-serving type.
            const ext = MIME_EXTENSIONS[file.mimetype] || '.jpg';
            const uniqueName = `report-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
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
    @Body() dto: CreateReportDto,
    @UploadedFiles() files?: { photos?: Express.Multer.File[] },
  ) {
    if (files?.photos?.length) {
      dto.images = files.photos.map(f => `/uploads/reports/${f.filename}`);
    }
    return this.reportsService.createReport(userId, dto);
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
    // Same validation as MapController#getObjects (this unauthenticated
    // endpoint previously accepted minLat=-90&maxLat=90&minLng=-180&maxLng=180,
    // turning a request into a full-table scan with no cap and no throttle —
    // a cheap DoS on a public endpoint as the reports table grows).
    if (nLat < -90 || xLat > 90 || nLng < -180 || xLng > 180) {
      throw new BadRequestException('Coordinates out of range');
    }
    if (nLat >= xLat || nLng >= xLng) {
      throw new BadRequestException('minLat must be less than maxLat, minLng less than maxLng');
    }
    if (xLat - nLat > 10 || xLng - nLng > 10) {
      throw new BadRequestException('Bounding box too large (max 10° per axis)');
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
    // Capped like every other bounds-checked list endpoint in the app (see
    // MapController#getObjects) — otherwise a client can pass an arbitrarily
    // large `limit` straight through to the Prisma `take`.
    return this.reportsService.getReportsByUser(userId, +page, Math.min(+limit, 100));
  }
}
