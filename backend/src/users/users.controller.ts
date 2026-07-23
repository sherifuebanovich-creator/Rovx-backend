import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  private deleteOldAvatar(avatarUrl?: string | null) {
    if (!avatarUrl || !avatarUrl.startsWith('/uploads/avatars/')) return;
    try {
      const filePath = join(process.cwd(), avatarUrl);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {}
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get full profile' })
  async getMyProfile(@CurrentUser('id') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Put('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update profile' })
  async updateProfile(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.usersService.updateProfile(userId, data);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('avatar', {
      // Kept in memory and stored inline in the DB as a data URI: Render's
      // free-tier filesystem is ephemeral, so anything written to uploads/
      // disappears on every deploy/restart and avatars silently break.
      // The frontend downsizes images before upload, so payloads stay small.
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|png|webp|gif)$/)) {
          return cb(new BadRequestException('Only JPEG, PNG, WebP, GIF images allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload avatar image' })
  async uploadAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    const currentProfile = await this.usersService.getProfile(userId) as any;
    if (currentProfile?.avatar) {
      this.deleteOldAvatar(currentProfile.avatar);
    }

    const avatarUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    return this.usersService.updateProfile(userId, { avatar: avatarUrl });
  }

  @Put('me/preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update preferences' })
  async updatePreferences(@CurrentUser('id') userId: string, @Body() prefs: any) {
    return this.usersService.updatePreferences(userId, prefs);
  }

  @Get('profile/:username')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get public profile by username' })
  async getProfile(
    @Param('username') username: string,
    @CurrentUser('id') viewerId: string,
  ) {
    return this.usersService.getPublicProfile(username, viewerId);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get top users leaderboard' })
  async getLeaderboard(@Query('limit') limit = 20) {
    return this.usersService.getLeaderboard(+limit);
  }

  @Get('me/achievements')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async getAchievements(@CurrentUser('id') userId: string) {
    return this.usersService.getAchievements(userId);
  }

  @Post('me/vehicles')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async addVehicle(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.usersService.addVehicle(userId, data);
  }

  @Get('me/vehicles')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async getVehicles(@CurrentUser('id') userId: string) {
    return this.usersService.getVehicles(userId);
  }

  @Delete('me/vehicles/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async deleteVehicle(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.usersService.deleteVehicle(id, userId);
  }

  // --- Fuel Logs ---

  @Post('me/fuel-logs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add fuel log' })
  async addFuelLog(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.usersService.addFuelLog(userId, data);
  }

  @Get('me/fuel-logs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get fuel logs' })
  async getFuelLogs(
    @CurrentUser('id') userId: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    return this.usersService.getFuelLogs(userId, vehicleId);
  }

  // --- Emergency Contacts ---

  @Post('me/emergency-contacts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add emergency contact' })
  async addEmergencyContact(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.usersService.addEmergencyContact(userId, data);
  }

  @Get('me/emergency-contacts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get emergency contacts' })
  async getEmergencyContacts(@CurrentUser('id') userId: string) {
    return this.usersService.getEmergencyContacts(userId);
  }

  @Delete('me/emergency-contacts/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete emergency contact' })
  async deleteEmergencyContact(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.usersService.deleteEmergencyContact(id, userId);
  }
}
