import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../websocket/gateway.service';
import { PremiumService, PREMIUM_TIERS } from '../premium/premium.service';
import { randomBytes } from 'crypto';

function generateInviteToken(): string {
  return randomBytes(6).toString('base64url');
}

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
        title: 'New follower',
        body: 'Someone started following you',
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

  async getConversations(userId: string, limit = 50) {
    const messages = await this.prisma.message.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit * 3, 150),
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

    return Array.from(conversations.values()).slice(0, limit);
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
        inviteToken: generateInviteToken(),
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
      where: { name: { equals: groupName, mode: 'insensitive' } },
    });
    if (!group) throw new NotFoundException('Группа с таким именем не найдена');
    if (!group.isPublic) throw new ForbiddenException('Группа закрытая');

    const existing = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId } },
    });
    if (existing) {
      if (existing.isBanned) throw new ForbiddenException('Вы заблокированы в этой группе');
      return { joined: true, group };
    }

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

    await this.prisma.$transaction([
      this.prisma.groupMember.create({ data: { groupId: group.id, userId } }),
      this.prisma.group.update({ where: { id: group.id }, data: { memberCount: { increment: 1 } } }),
    ]);

    await this.gateway.broadcastToGroup(group.id, 'group:member_joined', { userId });
    return { joined: true, group };
  }

  async joinGroup(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');

    if (!group.isPublic) throw new ForbiddenException('Группа закрытая');

    const existing = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (existing) {
      if (existing.isBanned) throw new ForbiddenException('Вы заблокированы в этой группе');
      return { joined: true };
    }

    if (group.city) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { city: true },
      });
      if (user?.city && user.city.toLowerCase() !== group.city.toLowerCase()) {
        throw new ForbiddenException(`Группа доступна только для города ${group.city}`);
      }
    }

    await this.prisma.$transaction([
      this.prisma.groupMember.create({ data: { groupId, userId } }),
      this.prisma.group.update({ where: { id: groupId }, data: { memberCount: { increment: 1 } } }),
    ]);

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

  // ── Invite Links ─────────────────────────────────────

  async joinByInviteToken(userId: string, token: string) {
    const group = await this.prisma.group.findUnique({ where: { inviteToken: token } });
    if (!group) throw new NotFoundException('Ссылка-приглашение недействительна');

    const existing = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId } },
    });
    if (existing) {
      if (existing.isBanned) throw new ForbiddenException('Вы заблокированы в этой группе');
      return { joined: true, group };
    }

    if (group.city) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { city: true } });
      if (user?.city && user.city.toLowerCase() !== group.city.toLowerCase()) {
        throw new ForbiddenException(`Группа доступна только для города ${group.city}`);
      }
    }

    await this.prisma.$transaction([
      this.prisma.groupMember.create({ data: { groupId: group.id, userId } }),
      this.prisma.group.update({ where: { id: group.id }, data: { memberCount: { increment: 1 } } }),
    ]);

    await this.gateway.broadcastToGroup(group.id, 'group:member_joined', { userId });
    return { joined: true, group };
  }

  async regenerateInviteToken(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (group.ownerId !== userId) throw new ForbiddenException('Только владелец может обновить ссылку');

    const newToken = generateInviteToken();
    await this.prisma.group.update({ where: { id: groupId }, data: { inviteToken: newToken } });
    return { inviteToken: newToken };
  }

  async getInviteToken(userId: string, groupId: string) {
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member) throw new ForbiddenException('Вы не участник группы');

    const group = await this.prisma.group.findUnique({ where: { id: groupId }, select: { inviteToken: true } });
    if (!group?.inviteToken) throw new NotFoundException('Ссылка-приглашение не создана');

    return { inviteToken: group.inviteToken };
  }

  // ── Moderation ───────────────────────────────────────

  private async checkAdmin(userId: string, groupId: string) {
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member?.isAdmin) throw new ForbiddenException('Нет прав администратора');
    return member;
  }

  private async checkOwner(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (group.ownerId !== userId) throw new ForbiddenException('Только владелец');
    return group;
  }

  async deleteMessage(userId: string, groupId: string, messageId: string) {
    const msg = await this.prisma.groupMessage.findUnique({ where: { id: messageId } });
    if (!msg || msg.groupId !== groupId) throw new NotFoundException('Сообщение не найдено');

    const isSender = msg.senderId === userId;
    if (!isSender) {
      const member = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (!member?.isAdmin) throw new ForbiddenException('Нет прав на удаление');
    }

    await this.prisma.groupMessage.update({ where: { id: messageId }, data: { isDeleted: true } });
    await this.gateway.broadcastToGroup(groupId, 'group:message_deleted', { messageId });
    return { deleted: true };
  }

  async banMember(userId: string, groupId: string, targetUserId: string) {
    await this.checkAdmin(userId, groupId);
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (group.ownerId === targetUserId) throw new ForbiddenException('Нельзя забанить владельца');

    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });
    if (!member) throw new NotFoundException('Пользователь не в группе');

    await this.prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { isBanned: true },
    });

    await this.gateway.broadcastToGroup(groupId, 'group:member_banned', { userId: targetUserId, bannedBy: userId });
    return { banned: true };
  }

  async unbanMember(userId: string, groupId: string, targetUserId: string) {
    await this.checkAdmin(userId, groupId);

    await this.prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { isBanned: false },
    });

    await this.gateway.broadcastToGroup(groupId, 'group:member_unbanned', { userId: targetUserId });
    return { unbanned: true };
  }

  async kickMember(userId: string, groupId: string, targetUserId: string) {
    await this.checkAdmin(userId, groupId);
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (group.ownerId === targetUserId) throw new ForbiddenException('Нельзя удалить владельца');

    const { count } = await this.prisma.groupMember.deleteMany({ where: { groupId, userId: targetUserId } });
    if (count === 0) throw new NotFoundException('Пользователь не в группе');

    await this.prisma.group.update({ where: { id: groupId }, data: { memberCount: { decrement: 1 } } });
    await this.gateway.broadcastToGroup(groupId, 'group:member_kicked', { userId: targetUserId, kickedBy: userId });
    return { kicked: true };
  }

  async promoteMember(userId: string, groupId: string, targetUserId: string) {
    await this.checkOwner(userId, groupId);

    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });
    if (!member) throw new NotFoundException('Пользователь не в группе');

    await this.prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { isAdmin: true },
    });

    await this.gateway.broadcastToGroup(groupId, 'group:member_promoted', { userId: targetUserId });
    return { promoted: true };
  }

  async demoteMember(userId: string, groupId: string, targetUserId: string) {
    await this.checkOwner(userId, groupId);

    await this.prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { isAdmin: false },
    });

    await this.gateway.broadcastToGroup(groupId, 'group:member_demoted', { userId: targetUserId });
    return { demoted: true };
  }

  // ── Favorites ─────────────────────────────────────────────

  async toggleFavorite(userId: string, groupId: string) {
    const existing = await this.prisma.groupFavorite.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (existing) {
      await this.prisma.groupFavorite.delete({ where: { id: existing.id } });
      return { favorited: false };
    }
    await this.prisma.groupFavorite.create({ data: { groupId, userId } });
    return { favorited: true };
  }

  async getMyFavorites(userId: string) {
    const favorites = await this.prisma.groupFavorite.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            owner: { select: { id: true, displayName: true, avatar: true } },
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return favorites.map(f => ({
      ...f.group,
      memberCount: f.group._count.members,
      isFavorited: true,
    }));
  }

  async getGroups(page = 1, limit = 20, region?: string, city?: string, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = { isPublic: true };

    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (region) where.region = { contains: region, mode: 'insensitive' };
    if (search) where.name = { contains: search, mode: 'insensitive' };

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

  async getGroupById(groupId: string, userId?: string) {
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

    let isMember = false;
    let isFavorited = false;
    let memberIsAdmin = false;
    if (userId) {
      const [membership, favorite] = await Promise.all([
        this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } }),
        this.prisma.groupFavorite.findUnique({ where: { groupId_userId: { groupId, userId } } }),
      ]);
      isMember = !!membership;
      isFavorited = !!favorite;
      memberIsAdmin = !!membership?.isAdmin;
    }

    const result: any = { ...group, memberCount: group._count.members, isMember, isFavorited };
    if (memberIsAdmin || userId === group.ownerId) {
      result.inviteToken = group.inviteToken;
    }
    return result;
  }

  async getGroupMessages(groupId: string, userId: string, page = 1, limit = 50) {
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member) return { messages: [], total: 0, isMember: false };
    if (member.isBanned) throw new ForbiddenException('Вы заблокированы в этой группе');

    const skip = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      this.prisma.groupMessage.findMany({
        where: { groupId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          sender: { select: { id: true, displayName: true, avatar: true } },
        },
      }),
      this.prisma.groupMessage.count({ where: { groupId, isDeleted: false } }),
    ]);

    return { messages: messages.reverse(), total, isMember: true };
  }

  async searchGroups(query: string, city?: string) {
    const where: any = {
      isPublic: true,
      name: { contains: query, mode: 'insensitive' },
    };
    if (city) where.city = { contains: city, mode: 'insensitive' };

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
    const trimmed = content.trim();
    if (trimmed.length > 2000) throw new BadRequestException('Message too long (max 2000 characters)');
    if (trimmed.length < 1) throw new BadRequestException('Message cannot be empty');

    const message = await this.prisma.cityChatMessage.create({
      data: { city: city.toLowerCase(), userId, content: trimmed },
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
