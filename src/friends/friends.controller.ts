import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Friends')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(private friendsService: FriendsService) {}

  @Get()
  @ApiOperation({ summary: 'Get my friends' })
  getFriends(@CurrentUser('id') userId: string) {
    return this.friendsService.getFriends(userId);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Get pending friend requests' })
  getRequests(@CurrentUser('id') userId: string) {
    return this.friendsService.getFriendRequests(userId);
  }

  @Post('request/:userId')
  @ApiOperation({ summary: 'Send friend request' })
  sendRequest(@CurrentUser('id') myId: string, @Param('userId') targetId: string) {
    return this.friendsService.sendRequest(myId, targetId);
  }

  @Post('accept/:userId')
  @ApiOperation({ summary: 'Accept friend request' })
  acceptRequest(@CurrentUser('id') myId: string, @Param('userId') targetId: string) {
    return this.friendsService.acceptRequest(myId, targetId);
  }

  @Delete('reject/:userId')
  @ApiOperation({ summary: 'Reject friend request' })
  rejectRequest(@CurrentUser('id') myId: string, @Param('userId') targetId: string) {
    return this.friendsService.rejectRequest(myId, targetId);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Remove friend' })
  removeFriend(@CurrentUser('id') myId: string, @Param('userId') targetId: string) {
    return this.friendsService.removeFriend(myId, targetId);
  }

  @Get('online')
  @ApiOperation({ summary: 'Get online friends' })
  getOnline(@CurrentUser('id') userId: string) {
    return this.friendsService.getOnlineFriends(userId);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search users' })
  searchUsers(@Query('q') query: string, @CurrentUser('id') userId: string) {
    return this.friendsService.searchUsers(query, userId);
  }
}
