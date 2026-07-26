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

    // The unique constraint is on the ORDERED pair (userId, friendId), so it
    // doesn't stop A and B from both creating a request to each other at
    // the same instant — (A,B) and (B,A) are distinct rows to Postgres,
    // producing a mirrored/duplicated relationship once one side gets
    // accepted. An advisory lock keyed by the unordered pair serializes
    // concurrent sendRequest calls between the same two users.
    const [lockA, lockB] = [userId, friendId].sort();
    const friend = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`friend:${lockA}:${lockB}`})::bigint)`;

      const existing = await tx.friend.findFirst({
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

      return tx.friend.create({
        data: { userId, friendId, status: 'PENDING' },
      });
    });

    const notification = await this.prisma.notification.create({
      data: {
        userId: friendId,
        type: 'friend_request',
        title: 'Friend request',
        body: 'You received a friend request',
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
    await this.invalidateFriendsListCache([userId, friendId]);

    const acceptedNotification = await this.prisma.notification.create({
      data: {
        userId: friendId,
        type: 'friend_accepted',
        title: 'Friend request accepted',
        body: 'Your friend request was accepted',
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
    await this.invalidateFriendsListCache([userId, friendId]);
    return { removed: true };
  }

  /**
   * The relationship join (who's friends with whom) barely changes between
   * calls, but `/friends/locations` is polled repeatedly by the client for
   * live map updates — without this cache, every single poll re-ran the
   * full friend join query just to re-derive a friend list that's almost
   * always identical to the one fetched seconds earlier. Only the static
   * part (id/name/avatar/city) is cached; online status is always read
   * fresh below so this can't go stale on that front. Short TTL plus
   * explicit invalidation on accept/remove keeps the window tiny.
   */
  private async getAcceptedFriendsRaw(userId: string) {
    const cacheKey = `friends:list:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch {}
    }

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

    const raw = friends.map(f => {
      const friend = f.userId === userId ? f.friend : f.user;
      return {
        id: friend.id,
        username: friend.username,
        displayName: friend.displayName,
        avatar: friend.avatar,
        city: friend.city,
        since: f.createdAt,
      };
    });

    await this.redis.set(cacheKey, JSON.stringify(raw), 20);
    return raw;
  }

  private async invalidateFriendsListCache(userIds: string[]) {
    await Promise.all(userIds.map(id => this.redis.del(`friends:list:${id}`)));
  }

  async getFriends(userId: string) {
    const [raw, onlineUserIds] = await Promise.all([
      this.getAcceptedFriendsRaw(userId),
      this.getValidOnlineUserIds(),
    ]);

    return raw.map((f: any) => ({
      ...f,
      isOnline: onlineUserIds.includes(f.id),
    }));
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
          { displayName: { contains: query, mode: 'insensitive' } },
          { username: { contains: query, mode: 'insensitive' } },
        ],
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

    // Was calling getFriends() (which itself calls getValidOnlineUserIds())
    // and then getValidOnlineUserIds() again independently — every search
    // keystroke did two redundant online-set lookups (SMEMBERS + MGET)
    // against Redis. Fetching the raw friend list and the online set once
    // each here does the same work in half the round trips.
    const [rawFriends, onlineUserIds] = await Promise.all([
      this.getAcceptedFriendsRaw(currentUserId),
      this.getValidOnlineUserIds(),
    ]);
    const friendIds = rawFriends.map((f: any) => f.id);
    return users.map(u => ({
      ...u,
      isFriend: friendIds.includes(u.id),
      isOnline: onlineUserIds.includes(u.id),
    }));
  }

  async getFriendsLocations(userId: string) {
    const friends = await this.getFriends(userId);
    const onlineFriends = friends.filter(f => f.isOnline);

    if (onlineFriends.length === 0) return [];

    const keys = onlineFriends.map(f => `location:${f.id}`);
    const results = await this.redis.mget(...keys);

    return onlineFriends
      .map((f, i) => {
        if (!results[i]) return null;
        try {
          const loc = JSON.parse(results[i]);
          return {
            userId: f.id,
            displayName: f.displayName,
            avatar: f.avatar,
            lat: loc.lat,
            lng: loc.lng,
            speed: loc.speed,
            heading: loc.heading,
            updatedAt: loc.updatedAt,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  private async getValidOnlineUserIds(): Promise<string[]> {
    const onlineIds = await this.redis.smembers('online:users');
    if (onlineIds.length === 0) return [];

    const keys = onlineIds.map(uid => `online:ts:${uid}`);
    const results = await this.redis.mget(...keys);

    const validIds: string[] = [];
    for (let i = 0; i < onlineIds.length; i++) {
      if (results[i]) validIds.push(onlineIds[i]);
    }
    return validIds;
  }
}
