import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { GatewayService } from '../websocket/gateway.service';

@Injectable()
export class FriendsService {
  private readonly logger = new Logger(FriendsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private gateway: GatewayService,
  ) {}

  async sendRequest(userId: string, friendId: string) {
    if (userId === friendId) throw new ConflictException('Cannot add yourself');

    const target = await this.prisma.user.findUnique({ where: { id: friendId } });
    if (!target) throw new NotFoundException('User not found');

    const existing = await this.prisma.friend.findFirst({
      where: {
        OR: [
          { userId, friendId },
          { userId: friendId, friendId: userId },
        ],
      },
    });
    if (existing) {
      if (existing.status === 'ACCEPTED') throw new ConflictException('Already friends');
      if (existing.status === 'PENDING') throw new ConflictException('Request already sent');
    }

    const friend = await this.prisma.friend.create({
      data: { userId, friendId, status: 'PENDING' },
    });

    const notification = await this.prisma.notification.create({
      data: {
        userId: friendId,
        type: 'friend_request',
        title: 'Запрос в друзья',
        body: 'Вам отправили запрос в друзья',
        data: JSON.stringify({ userId }),
      },
    });

    await this.gateway.sendToUser(friendId, 'notification:new', notification);
    await this.gateway.sendToUser(friendId, 'friend:request', { userId, status: 'PENDING' });

    return friend;
  }

  async acceptRequest(userId: string, friendId: string) {
    const request = await this.prisma.friend.findFirst({
      where: { userId: friendId, friendId: userId, status: 'PENDING' },
    });
    if (!request) throw new NotFoundException('Request not found');

    await this.prisma.friend.update({
      where: { id: request.id },
      data: { status: 'ACCEPTED' },
    });

    const acceptedNotification = await this.prisma.notification.create({
      data: {
        userId: friendId,
        type: 'friend_accepted',
        title: 'Запрос принят',
        body: 'Ваш запрос в друзья принят',
        data: JSON.stringify({ userId }),
      },
    });

    await this.gateway.sendToUser(friendId, 'notification:new', acceptedNotification);
    await this.gateway.sendToUser(friendId, 'friend:accepted', { userId, status: 'ACCEPTED' });

    return { accepted: true };
  }

  async rejectRequest(userId: string, friendId: string) {
    await this.prisma.friend.deleteMany({
      where: {
        OR: [
          { userId: friendId, friendId: userId, status: 'PENDING' },
          { userId, friendId: friendId, status: 'PENDING' },
        ],
      },
    });
    return { rejected: true };
  }

  async removeFriend(userId: string, friendId: string) {
    await this.prisma.friend.deleteMany({
      where: {
        OR: [
          { userId, friendId },
          { userId: friendId, friendId: userId },
        ],
        status: 'ACCEPTED',
      },
    });
    return { removed: true };
  }

  async getFriends(userId: string) {
    const friends = await this.prisma.friend.findMany({
      where: {
        OR: [{ userId }, { friendId: userId }],
        status: 'ACCEPTED',
      },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatar: true, city: true } },
        friend: { select: { id: true, username: true, displayName: true, avatar: true, city: true } },
      },
    });

    const onlineUserIds = await this.redis.smembers('online:users');

    return friends.map(f => {
      const friend = f.userId === userId ? f.friend : f.user;
      return {
        id: friend.id,
        username: friend.username,
        displayName: friend.displayName,
        avatar: friend.avatar,
        city: friend.city,
        isOnline: onlineUserIds.includes(friend.id),
        since: f.createdAt,
      };
    });
  }

  async getFriendRequests(userId: string) {
    const requests = await this.prisma.friend.findMany({
      where: { friendId: userId, status: 'PENDING' },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatar: true } },
      },
    });
    return requests.map(r => ({
      id: r.id,
      user: r.user,
      createdAt: r.createdAt,
    }));
  }

  async getOnlineFriends(userId: string): Promise<string[]> {
    const friends = await this.getFriends(userId);
    return friends.filter(f => f.isOnline).map(f => f.id);
  }

  async searchUsers(query: string, currentUserId: string) {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: query } },
          { displayName: { contains: query } },
        ],
        id: { not: currentUserId },
        isActive: true,
        isBanned: false,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        city: true,
      },
      take: 20,
    });

    const friendIds = (await this.getFriends(currentUserId)).map(f => f.id);
    return users.map(u => ({
      ...u,
      isFriend: friendIds.includes(u.id),
    }));
  }
}
