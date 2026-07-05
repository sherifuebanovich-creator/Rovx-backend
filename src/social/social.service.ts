import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../websocket/gateway.service';
import { PremiumService, PREMIUM_TIERS } from '../premium/premium.service';

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: GatewayService,
    private premiumService: PremiumService,
  ) {}

  // ── Follow ──────────────────────────────────────────────

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new ConflictException('Cannot follow yourself');
    }

    const existing = await this.prisma.follow.findFirst({
      where: { followerId, followingId },
    });
    if (existing) throw new ConflictException('Already following');

    const follow = await this.prisma.follow.create({
      data: { followerId, followingId },
    });

    const notification = await this.prisma.notification.create({
      data: {
        userId: followingId,
        type: 'new_follower',
        title: 'Новый подписчик',
        body: 'На вас подписались',
        data: JSON.stringify({ followerId }),
      },
    });

    await this.gateway.sendToUser(followingId, 'notification:new', notification);

    return follow;
  }

  async unfollow(followerId: string, followingId: string) {
    await this.prisma.follow.deleteMany({ where: { followerId, followingId } });
    return { unfollowed: true };
  }

  async getFollowers(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [followers, total] = await Promise.all([
      this.prisma.follow.findMany({
        where: { followingId: userId },
        include: {
          follower: {
            select: { id: true, username: true, displayName: true, avatar: true, reputation: true, city: true },
          },
        },
        skip,
        take: limit,
      }),
      this.prisma.follow.count({ where: { followingId: userId } }),
    ]);
    return { followers: followers.map((f) => f.follower), total };
  }

  async getFollowing(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [following, total] = await Promise.all([
      this.prisma.follow.findMany({
        where: { followerId: userId },
        include: {
          following: {
            select: { id: true, username: true, displayName: true, avatar: true, reputation: true, city: true },
          },
        },
        skip,
        take: limit,
      }),
      this.prisma.follow.count({ where: { followerId: userId } }),
    ]);
    return { following: following.map((f) => f.following), total };
  }

  // ── Messages ────────────────────────────────────────────

  async getConversations(userId: string) {
    const messages = await this.prisma.message.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { id: true, displayName: true, avatar: true } },
        receiver: { select: { id: true, displayName: true, avatar: true } },
      },
    });

    const conversations = new Map<string, any>();
    for (const msg of messages) {
      const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      const partner = msg.senderId === userId ? msg.receiver : msg.sender;
      if (!conversations.has(partnerId)) {
        conversations.set(partnerId, {
          partner,
          lastMessage: msg,
          unreadCount: msg.receiverId === userId && !msg.isRead ? 1 : 0,
        });
      } else {
        const conv = conversations.get(partnerId);
        if (!msg.isRead && msg.receiverId === userId) {
          conv.unreadCount++;
        }
      }
    }

    return Array.from(conversations.values());
  }

  async getMessages(userId: string, partnerId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          OR: [
            { senderId: userId, receiverId: partnerId },
            { senderId: partnerId, receiverId: userId },
          ],
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.message.count({
        where: {
          OR: [
            { senderId: userId, receiverId: partnerId },
            { senderId: partnerId, receiverId: userId },
          ],
        },
      }),
    ]);

    await this.prisma.message.updateMany({
      where: { senderId: partnerId, receiverId: userId, isRead: false },
      data: { isRead: true },
    });

    return { messages: messages.reverse(), total };
  }

  // ── Groups ──────────────────────────────────────────────

  async createGroup(userId: string, data: any) {
    const check = await this.premiumService.canCreateGroup(userId);
    if (!check.allowed) {
      throw new ForbiddenException(
        `Создание групп доступно только для ${check.tierRequired}. Лимит: ${check.currentGroups}/${check.maxGroups}`,
      );
    }

    const existing = await this.prisma.group.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' } } });
    if (existing) {
      throw new ConflictException('Группа с таким именем уже существует');
    }

    const group = await this.prisma.group.create({
      data: {
        name: data.name,
        description: data.description || '',
        avatar: data.avatar,
        region: data.region,
        city: data.city,
        ownerId: userId,
        isPublic: data.isPublic ?? true,
        members: {
          create: { userId, isAdmin: true },
        },
        memberCount: 1,
      },
      include: {
        owner: { select: { id: true, displayName: true, avatar: true } },
      },
    });

    this.logger.log(`Group created: ${data.name} by user ${userId}`);
    return group;
  }

  async updateGroup(userId: string, groupId: string, data: any) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');

    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member?.isAdmin) throw new ForbiddenException('Only admin can edit group');

    if (data.name && data.name !== group.name) {
      const existing = await this.prisma.group.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' } } });
      if (existing) throw new ConflictException('Это имя группы уже используется');
    }

    const updated = await this.prisma.group.update({
      where: { id: groupId },
      data: {
        name: data.name,
        description: data.description,
        avatar: data.avatar,
        region: data.region,
        city: data.city,
        isPublic: data.isPublic,
      },
    });

    await this.gateway.broadcastToGroup(groupId, 'group:updated', updated);
    return updated;
  }

  async deleteGroup(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (group.ownerId !== userId) throw new ForbiddenException('Only owner can delete group');

    await this.prisma.group.delete({ where: { id: groupId } });
    await this.gateway.broadcastToGroup(groupId, 'group:deleted', { groupId });
    return { deleted: true };
  }

  async getMyGroups(userId: string) {
    const memberships = await this.prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            owner: { select: { id: true, displayName: true, avatar: true } },
            _count: { select: { members: true } },
          },
        },
      },
    });
    return memberships.map(m => ({
      ...m.group,
      isAdmin: m.isAdmin,
      memberCount: m.group._count.members,
    }));
  }

  async joinGroupByName(userId: string, groupName: string) {
    const group = await this.prisma.group.findFirst({
      where: { name: { equals: groupName } },
    });
    if (!group) throw new NotFoundException('Группа с таким именем не найдена');
    if (!group.isPublic) throw new ForbiddenException('Группа закрытая');

    const existing = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId } },
    });
    if (existing) return { joined: true, group };

    // Check user's city matches group city if city is set
    if (group.city) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { city: true },
      });
      if (user?.city && user.city.toLowerCase() !== group.city.toLowerCase()) {
        throw new ForbiddenException(`Группа доступна только для города ${group.city}`);
      }
    }

    await this.prisma.groupMember.create({
      data: { groupId: group.id, userId },
    });
    await this.prisma.group.update({
      where: { id: group.id },
      data: { memberCount: { increment: 1 } },
    });

    await this.gateway.broadcastToGroup(group.id, 'group:member_joined', { userId });
    return { joined: true, group };
  }

  async joinGroup(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');

    const existing = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (existing) return { joined: true };

    if (group.city) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { city: true },
      });
      if (user?.city && user.city.toLowerCase() !== group.city.toLowerCase()) {
        throw new ForbiddenException(`Группа доступна только для города ${group.city}`);
      }
    }

    await this.prisma.groupMember.create({ data: { groupId, userId } });
    await this.prisma.group.update({
      where: { id: groupId },
      data: { memberCount: { increment: 1 } },
    });

    await this.gateway.broadcastToGroup(groupId, 'group:member_joined', { userId });
    return { joined: true };
  }

  async leaveGroup(userId: string, groupId: string) {
    const { count } = await this.prisma.groupMember.deleteMany({ where: { groupId, userId } });
    if (count > 0) {
      await this.prisma.group.update({
        where: { id: groupId },
        data: { memberCount: { decrement: 1 } },
      });
    }
    return { left: true };
  }

  async getGroups(page = 1, limit = 20, region?: string, city?: string, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = { isPublic: true };

    if (city) where.city = { contains: city };
    if (region) where.region = { contains: region };
    if (search) where.name = { contains: search };

    const [groups, total] = await Promise.all([
      this.prisma.group.findMany({
        where,
        orderBy: { memberCount: 'desc' },
        skip,
        take: limit,
        include: {
          owner: { select: { id: true, displayName: true, avatar: true } },
          _count: { select: { members: true } },
        },
      }),
      this.prisma.group.count({ where }),
    ]);

    return {
      groups: groups.map(g => ({ ...g, memberCount: g._count.members })),
      total,
    };
  }

  async getGroupById(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        owner: { select: { id: true, displayName: true, avatar: true, city: true } },
        members: {
          include: {
            user: { select: { id: true, username: true, displayName: true, avatar: true } },
          },
        },
        _count: { select: { members: true } },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    return { ...group, memberCount: group._count.members };
  }

  async getGroupMessages(groupId: string, userId: string, page = 1, limit = 50) {
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member) throw new ForbiddenException('Not a member');

    const skip = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      this.prisma.groupMessage.findMany({
        where: { groupId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          sender: { select: { id: true, displayName: true, avatar: true } },
        },
      }),
      this.prisma.groupMessage.count({ where: { groupId } }),
    ]);

    return { messages: messages.reverse(), total };
  }

  async searchGroups(query: string, city?: string) {
    const where: any = {
      isPublic: true,
      name: { contains: query },
    };
    if (city) where.city = { contains: city };

    const groups = await this.prisma.group.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        avatar: true,
        city: true,
        memberCount: true,
        owner: { select: { displayName: true } },
      },
      take: 20,
    });

    return groups;
  }

  // ── City Chat ───────────────────────────────────────────

  async getCityMessages(city: string, page = 1, limit = 50) {
    if (!city) return { messages: [], total: 0 };
    const skip = (page - 1) * limit;
    const lower = city.toLowerCase();
    const [messages, total] = await Promise.all([
      this.prisma.cityChatMessage.findMany({
        where: { city: { equals: lower, mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: { select: { id: true, displayName: true, avatar: true } },
        },
      }),
      this.prisma.cityChatMessage.count({
        where: { city: { equals: lower, mode: 'insensitive' } },
      }),
    ]);
    return { messages: messages.reverse(), total };
  }

  async sendCityMessage(userId: string, city: string, content: string) {
    if (!city || !content?.trim()) throw new BadRequestException('City and content required');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, avatar: true },
    });
    const message = await this.prisma.cityChatMessage.create({
      data: { city: city.toLowerCase(), userId, content: content.trim() },
      include: {
        user: { select: { id: true, displayName: true, avatar: true } },
      },
    });
    return message;
  }

  // ── Notifications ───────────────────────────────────────

  async getNotifications(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);
    return { notifications, total };
  }

  async markNotificationsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { updated: true };
  }

  async deleteAllNotifications(userId: string) {
    const { count } = await this.prisma.notification.deleteMany({
      where: { userId },
    });
    return { deleted: count };
  }
}
