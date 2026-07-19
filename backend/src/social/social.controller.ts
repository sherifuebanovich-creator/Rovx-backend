import {
  Controller, Post, Put, Delete, Get, Body, Param, Query, UseGuards, UseInterceptors,
  UploadedFile, UploadedFiles, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { SocialService } from './social.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Social')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social')
export class SocialController {
  constructor(private socialService: SocialService) {}

  // ── Follow ──
  @Post('follow/:userId')
  @ApiOperation({ summary: 'Follow a user' })
  async follow(@CurrentUser('id') myId: string, @Param('userId') targetId: string) {
    return this.socialService.follow(myId, targetId);
  }

  @Delete('follow/:userId')
  @ApiOperation({ summary: 'Unfollow a user' })
  async unfollow(@CurrentUser('id') myId: string, @Param('userId') targetId: string) {
    return this.socialService.unfollow(myId, targetId);
  }

  @Get('followers')
  async getFollowers(@CurrentUser('id') userId: string, @Query('page') page = 1) {
    return this.socialService.getFollowers(userId, +page);
  }

  @Get('following')
  async getFollowing(@CurrentUser('id') userId: string, @Query('page') page = 1) {
    return this.socialService.getFollowing(userId, +page);
  }

  // ── Messages ──
  @Get('messages')
  @ApiOperation({ summary: 'Get conversations' })
  async getConversations(@CurrentUser('id') userId: string) {
    return this.socialService.getConversations(userId);
  }

  @Get('messages/:partnerId')
  @ApiOperation({ summary: 'Get messages with user' })
  async getMessages(
    @CurrentUser('id') userId: string,
    @Param('partnerId') partnerId: string,
    @Query('page') page = 1,
  ) {
    return this.socialService.getMessages(userId, partnerId, +page);
  }

  // ── Groups ──
  @Post('groups')
  @ApiOperation({ summary: 'Create group (Premium required)' })
  async createGroup(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.socialService.createGroup(userId, data);
  }

  @Post('groups/:groupId/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'avatars');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const uniqueName = `group-${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
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
  @ApiOperation({ summary: 'Upload group avatar' })
  async uploadGroupAvatar(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const avatarUrl = `/uploads/avatars/${file.filename}`;
    return this.socialService.updateGroup(userId, groupId, { avatar: avatarUrl });
  }

  @Put('groups/:groupId')
  @ApiOperation({ summary: 'Update group (admin only)' })
  async updateGroup(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @Body() data: any,
  ) {
    return this.socialService.updateGroup(userId, groupId, data);
  }

  @Post('groups/:groupId/messages/upload')
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'messages');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const uniqueName = `msg-${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^(image\/|video\/)/)) {
          return cb(new BadRequestException('Only images and videos allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload media for group message' })
  async uploadGroupMessageMedia(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    await this.socialService.assertMember(groupId, userId);
    if (!files?.length) throw new BadRequestException('No files uploaded');
    const urls = files.map(f => `/uploads/messages/${f.filename}`);
    return { urls };
  }

  @Post('groups/:groupId/messages/upload-audio')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'audio');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const uniqueName = `voice-${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname) || '.webm'}`;
          cb(null, uniqueName);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^audio\//)) {
          return cb(new BadRequestException('Only audio files allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload voice message for group chat' })
  async uploadGroupAudio(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.socialService.assertMember(groupId, userId);
    if (!file) throw new BadRequestException('No audio file uploaded');
    const url = `/uploads/audio/${file.filename}`;
    return { url };
  }

  @Post('groups/:groupId/messages/upload-video-msg')
  @UseInterceptors(
    FileInterceptor('video', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'video-messages');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const uniqueName = `videomsg-${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname) || '.webm'}`;
          cb(null, uniqueName);
        },
      }),
      // Recording is capped at 60s client-side (VideoMessageRecorder.tsx);
      // a 60s webm/vp8+opus clip can plausibly exceed 10MB, so the limit
      // needs enough headroom to not reject legitimate full-length clips.
      limits: { fileSize: 30 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        // Some mobile browsers/webviews send recorded video Blobs with a
        // generic/missing Content-Type (application/octet-stream or empty)
        // instead of the actual video/* mimetype. Fall back to the file
        // extension in that case rather than rejecting a genuine video.
        const isVideoMime = /^video\//.test(file.mimetype);
        const isGenericMime = !file.mimetype || file.mimetype === 'application/octet-stream';
        const hasVideoExt = /\.(webm|mp4|mov|m4v|3gp)$/i.test(file.originalname || '');
        if (!isVideoMime && !(isGenericMime && hasVideoExt)) {
          return cb(new BadRequestException('Only video files allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload video message for group chat' })
  async uploadGroupVideoMsg(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.socialService.assertMember(groupId, userId);
    if (!file) throw new BadRequestException('No video file uploaded');
    const url = `/uploads/video-messages/${file.filename}`;
    return { url };
  }

  @Delete('groups/:groupId')
  @ApiOperation({ summary: 'Delete group (owner only)' })
  async deleteGroup(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.socialService.deleteGroup(userId, groupId);
  }

  @Get('groups')
  @ApiOperation({ summary: 'List groups' })
  async getGroups(
    @CurrentUser('id') userId: string,
    @Query('page') page = 1,
    @Query('region') region?: string,
    @Query('city') city?: string,
    @Query('search') search?: string,
  ) {
    return this.socialService.getGroups(+page, 20, region, city, search, userId);
  }

  @Get('groups/my')
  @ApiOperation({ summary: 'Get my groups' })
  async getMyGroups(@CurrentUser('id') userId: string) {
    return this.socialService.getMyGroups(userId);
  }

  @Get('groups/search')
  @ApiOperation({ summary: 'Search groups' })
  async searchGroups(@CurrentUser('id') userId: string, @Query('q') query: string, @Query('city') city?: string) {
    return this.socialService.searchGroups(query, city, userId);
  }

  @Get('groups/favorites')
  @ApiOperation({ summary: 'Get my favorite groups' })
  async getMyFavorites(@CurrentUser('id') userId: string) {
    return this.socialService.getMyFavorites(userId);
  }

  @Get('groups/:groupId')
  @ApiOperation({ summary: 'Get group details' })
  async getGroup(@CurrentUser('id') userId: string, @Param('groupId') groupId: string) {
    return this.socialService.getGroupById(groupId, userId);
  }

  @Get('groups/:groupId/messages')
  @ApiOperation({ summary: 'Get group messages' })
  async getGroupMessages(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @Query('page') page = 1,
  ) {
    return this.socialService.getGroupMessages(groupId, userId, +page);
  }

  @Post('groups/join-by-name')
  @ApiOperation({ summary: 'Join group by name' })
  async joinGroupByName(@CurrentUser('id') userId: string, @Body() data: { name: string }) {
    return this.socialService.joinGroupByName(userId, data.name);
  }

  @Post('groups/:groupId/join')
  async joinGroup(@CurrentUser('id') userId: string, @Param('groupId') groupId: string) {
    return this.socialService.joinGroup(userId, groupId);
  }

  @Post('groups/:groupId/leave')
  async leaveGroup(@CurrentUser('id') userId: string, @Param('groupId') groupId: string) {
    return this.socialService.leaveGroup(userId, groupId);
  }

  // ── Invite Links ──
  @Post('groups/join/:token')
  @ApiOperation({ summary: 'Join group by invite token' })
  async joinByToken(@CurrentUser('id') userId: string, @Param('token') token: string) {
    return this.socialService.joinByInviteToken(userId, token);
  }

  @Get('groups/:groupId/invite-link')
  @ApiOperation({ summary: 'Get invite link (admin only)' })
  async getInviteLink(@CurrentUser('id') userId: string, @Param('groupId') groupId: string) {
    return this.socialService.getInviteToken(userId, groupId);
  }

  @Post('groups/:groupId/invite-link')
  @ApiOperation({ summary: 'Regenerate invite link (owner only)' })
  async regenerateInviteLink(@CurrentUser('id') userId: string, @Param('groupId') groupId: string) {
    return this.socialService.regenerateInviteToken(userId, groupId);
  }

  // ── Moderation ──
  @Delete('groups/:groupId/messages/:messageId')
  @ApiOperation({ summary: 'Delete message (sender or admin)' })
  async deleteMessage(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.socialService.deleteMessage(userId, groupId, messageId);
  }

  @Post('groups/:groupId/ban/:targetUserId')
  @ApiOperation({ summary: 'Ban user from group (admin)' })
  async banMember(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.socialService.banMember(userId, groupId, targetUserId);
  }

  @Post('groups/:groupId/unban/:targetUserId')
  @ApiOperation({ summary: 'Unban user (admin)' })
  async unbanMember(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.socialService.unbanMember(userId, groupId, targetUserId);
  }

  @Post('groups/:groupId/kick/:targetUserId')
  @ApiOperation({ summary: 'Kick user (admin)' })
  async kickMember(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.socialService.kickMember(userId, groupId, targetUserId);
  }

  @Post('groups/:groupId/promote/:targetUserId')
  @ApiOperation({ summary: 'Promote to admin (owner)' })
  async promoteMember(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.socialService.promoteMember(userId, groupId, targetUserId);
  }

  @Post('groups/:groupId/demote/:targetUserId')
  @ApiOperation({ summary: 'Demote admin (owner)' })
  async demoteMember(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.socialService.demoteMember(userId, groupId, targetUserId);
  }

  @Post('groups/:groupId/favorite')
  @ApiOperation({ summary: 'Toggle group favorite' })
  async toggleFavorite(@CurrentUser('id') userId: string, @Param('groupId') groupId: string) {
    return this.socialService.toggleFavorite(userId, groupId);
  }

  // ── Join Requests ──
  @Get('groups/:groupId/requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get pending join requests for a group' })
  async getPendingRequests(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.socialService.getPendingRequests(userId, groupId);
  }

  @Post('groups/:groupId/requests/:requestId/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a join request' })
  async approveRequest(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.socialService.approveRequest(userId, groupId, requestId);
  }

  @Post('groups/:groupId/requests/:requestId/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a join request' })
  async rejectRequest(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.socialService.rejectRequest(userId, groupId, requestId);
  }

  @Get('groups/:groupId/request-status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user request status for a group' })
  async getRequestStatus(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
  ) {
    const status = await this.socialService.getUserRequestStatus(userId, groupId);
    return { status };
  }

  // ── City Chat ──
  @Get('chat/city/:cityName')
  @ApiOperation({ summary: 'Get city chat messages' })
  async getCityChat(
    @Param('cityName') city: string,
    @Query('page') page = 1,
  ) {
    return this.socialService.getCityMessages(city, +page);
  }

  @Post('chat/city/:cityName')
  @ApiOperation({ summary: 'Send city chat message' })
  async sendCityChat(
    @CurrentUser('id') userId: string,
    @Param('cityName') city: string,
    @Body('content') content: string,
  ) {
    return this.socialService.sendCityMessage(userId, city, content);
  }

  // ── Notifications ──
  @Get('notifications')
  async getNotifications(@CurrentUser('id') userId: string, @Query('page') page = 1) {
    return this.socialService.getNotifications(userId, +page);
  }

  @Post('notifications/read')
  async markRead(@CurrentUser('id') userId: string) {
    return this.socialService.markNotificationsRead(userId);
  }

  @Delete('notifications')
  @ApiOperation({ summary: 'Delete all user notifications' })
  async deleteAll(@CurrentUser('id') userId: string) {
    return this.socialService.deleteAllNotifications(userId);
  }
}
