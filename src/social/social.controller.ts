import {
  Controller, Post, Put, Delete, Get, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
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

  @Put('groups/:groupId')
  @ApiOperation({ summary: 'Update group (admin only)' })
  async updateGroup(
    @CurrentUser('id') userId: string,
    @Param('groupId') groupId: string,
    @Body() data: any,
  ) {
    return this.socialService.updateGroup(userId, groupId, data);
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
  @ApiOperation({ summary: 'List public groups' })
  async getGroups(
    @Query('page') page = 1,
    @Query('region') region?: string,
    @Query('city') city?: string,
    @Query('search') search?: string,
  ) {
    return this.socialService.getGroups(+page, 20, region, city, search);
  }

  @Get('groups/my')
  @ApiOperation({ summary: 'Get my groups' })
  async getMyGroups(@CurrentUser('id') userId: string) {
    return this.socialService.getMyGroups(userId);
  }

  @Get('groups/search')
  @ApiOperation({ summary: 'Search groups' })
  async searchGroups(@Query('q') query: string, @Query('city') city?: string) {
    return this.socialService.searchGroups(query, city);
  }

  @Get('groups/:groupId')
  @ApiOperation({ summary: 'Get group details' })
  async getGroup(@Param('groupId') groupId: string) {
    return this.socialService.getGroupById(groupId);
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
