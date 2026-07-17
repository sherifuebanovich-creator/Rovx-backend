import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { GatewayService } from '../websocket/gateway.service';
import { ROLE_HIERARCHY, USER_ROLES, UserRole } from '../common/constants/roles';
import * as bcrypt from 'bcrypt';
import * as os from 'os';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private gatewayService: GatewayService,
  ) {}

  // ─── USERS ────────────────────────────────────────────────────────────────

  async getUsers(page = 1, limit = 20, search?: string, role?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search } },
        { username: { contains: search } },
        { displayName: { contains: search } },
      ];
    }
    if (role) where.role = role;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, username: true, displayName: true,
          role: true, subscription: true, isActive: true, isBanned: true,
          createdAt: true, reputation: true, totalTrips: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total, page, limit };
  }

  async getUserDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        vehicles: true,
        _count: {
          select: { trips: true, reports: true, followers: true, following: true },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash, refreshToken, ...safe } = user;
    return safe;
  }

  private assertCanActOn(actorRole: UserRole | undefined, targetRole: UserRole) {
    const actorLevel = ROLE_HIERARCHY[actorRole as UserRole] || 0;
    const targetLevel = ROLE_HIERARCHY[targetRole] || 0;
    if (targetLevel >= actorLevel) {
      throw new ForbiddenException('Cannot act on a user with an equal or higher role');
    }
  }

  async banUser(id: string, reason: string, adminId?: string, actorRole?: UserRole) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (adminId && id === adminId) throw new BadRequestException('Cannot ban yourself');
    this.assertCanActOn(actorRole, user.role as UserRole);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { isBanned: true, bannedReason: reason, isActive: false },
    });
    await this.gatewayService.disconnectUser(id);
    return updated;
  }

  async unbanUser(id: string, adminId?: string, actorRole?: UserRole) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (adminId && id === adminId) throw new BadRequestException('Cannot unban yourself');
    this.assertCanActOn(actorRole, user.role as UserRole);
    return this.prisma.user.update({
      where: { id },
      data: { isBanned: false, bannedReason: null, isActive: true },
    });
  }

  async updateUserRole(id: string, role: string, adminId?: string, actorRole?: UserRole) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (adminId && id === adminId) throw new BadRequestException('Cannot change your own role');
    this.assertCanActOn(actorRole, user.role as UserRole);
    const newLevel = ROLE_HIERARCHY[role as UserRole] || 0;
    const actorLevel = ROLE_HIERARCHY[actorRole as UserRole] || 0;
    if (newLevel >= actorLevel && actorRole !== USER_ROLES.SUPERADMIN) {
      throw new ForbiddenException('Cannot grant a role equal to or higher than your own');
    }
    return this.prisma.user.update({ where: { id }, data: { role: role as any } });
  }

  // ─── REPORTS ──────────────────────────────────────────────────────────────

  async getReports(page = 1, limit = 20, status?: string, type?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;
    if (type) where.type = type;

    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, username: true, reputation: true } },
        },
      }),
      this.prisma.report.count({ where }),
    ]);

    return { reports, total, page, limit };
  }

  async moderateReport(id: string, status: string) {
    const validStatuses = ['ACTIVE', 'CONFIRMED', 'EXPIRED', 'REJECTED', 'RESOLVED'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }
    const report = await this.prisma.report.findUnique({ where: { id }, select: { id: true } });
    if (!report) throw new NotFoundException('Report not found');
    return this.prisma.report.update({
      where: { id },
      data: { status: status as any },
    });
  }

  // ─── MAP OBJECTS ──────────────────────────────────────────────────────────

  async getMapObjects(page = 1, limit = 20, category?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (category) where.category = category;

    const [objects, total] = await Promise.all([
      this.prisma.mapObject.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' },
      }),
      this.prisma.mapObject.count({ where }),
    ]);

    return { objects, total, page, limit };
  }

  async createMapObject(data: any) {
    return this.prisma.mapObject.create({ data });
  }

  async updateMapObject(id: string, data: any) {
    return this.prisma.mapObject.update({ where: { id }, data });
  }

  async deleteMapObject(id: string) {
    await this.prisma.mapObject.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── ANALYTICS ────────────────────────────────────────────────────────────

  async getStats() {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      reportsPerHour,
      reportsPerDay,
      reportsPerWeek,
      reportsPerMonth,
      premiumToday,
      premiumWeek,
      premiumMonth,
      onlineIds,
    ] = await Promise.all([
      this.prisma.report.count({ where: { createdAt: { gte: hourAgo } } }),
      this.prisma.report.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.report.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.report.count({ where: { createdAt: { gte: monthAgo } } }),
      this.prisma.premiumSubscription.count({ where: { status: 'active', createdAt: { gte: dayAgo } } }),
      this.prisma.premiumSubscription.count({ where: { status: 'active', createdAt: { gte: weekAgo } } }),
      this.prisma.premiumSubscription.count({ where: { status: 'active', createdAt: { gte: monthAgo } } }),
      this.redis.smembers('online:users'),
    ]);

    // Online users with names
    const onlineUsers = onlineIds.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: onlineIds as string[] } },
          select: { id: true, username: true, displayName: true, avatar: true, city: true },
        })
      : [];

    // Premium purchases with details
    const premiumDetails = await this.prisma.premiumSubscription.findMany({
      where: { status: 'active', createdAt: { gte: monthAgo } },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, username: true, displayName: true, email: true } },
      },
    });

    // Server load
    let cpu = 0; let mem = 0;
    try {
      const cpus = os.cpus();
      let totalIdle = 0; let totalTick = 0;
      for (const c of cpus) {
        const sum = Object.values(c.times) as number[];
        totalTick += sum.reduce((a, b) => a + b, 0);
        totalIdle += c.times.idle;
      }
      cpu = totalTick > 0 ? Math.round((1 - totalIdle / totalTick) * 100) : 0;
      mem = Math.round((1 - os.freemem() / os.totalmem()) * 100);
    } catch {}

    return {
      reports: { hour: reportsPerHour, day: reportsPerDay, week: reportsPerWeek, month: reportsPerMonth },
      premium: { today: premiumToday, week: premiumWeek, month: premiumMonth, details: premiumDetails },
      online: { count: onlineUsers.length, users: onlineUsers },
      server: { cpu, memory: mem },
    };
  }

  async getPremiumDetail(id: string) {
    const sub = await this.prisma.premiumSubscription.findUnique({
      where: { id },
      include: { user: { select: { id: true, username: true, displayName: true, email: true } } },
    });
    if (!sub) throw new NotFoundException('Premium subscription not found');
    return sub;
  }

  async getDashboardStats() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers, newUsersToday, newUsersWeek,
      totalTrips, tripsToday,
      activeReports, totalReports,
      totalMapObjects,
      premiumUsers, onlineUsers,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.trip.count(),
      this.prisma.trip.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.report.count({ where: { status: { in: ['ACTIVE', 'CONFIRMED'] } } }),
      this.prisma.report.count(),
      this.prisma.mapObject.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { subscription: { in: ['PREMIUM_BASIC', 'PREMIUM_STANDARD', 'PREMIUM_MAX'] } } }),
      this.redis.smembers('online:users').then((m) => m.length),
    ]);

    // User growth chart (last 30 days, grouped by day)
    const userGrowth = await this.prisma.$queryRaw<{ date: string; count: number }[]>`
      SELECT DATE("createdAt") AS date, COUNT(*) AS count
      FROM "users"
      WHERE "createdAt" >= ${monthAgo}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `.then((rows) => rows.map((r) => ({ date: new Date(r.date), count: Number(r.count) })));

    // Report types distribution
    const reportTypes = await this.prisma.report.groupBy({
      by: ['type'],
      _count: true,
      orderBy: { _count: { type: 'desc' } },
      take: 10,
    });

    return {
      users: { total: totalUsers, newToday: newUsersToday, newThisWeek: newUsersWeek, online: onlineUsers },
      trips: { total: totalTrips, today: tripsToday },
      reports: { active: activeReports, total: totalReports },
      mapObjects: { total: totalMapObjects },
      revenue: { premiumUsers },
      charts: { userGrowth, reportTypes },
    };
  }

  async getSubscriptionStats() {
    const byTier = await this.prisma.user.groupBy({
      by: ['subscription'],
      _count: true,
    });

    return { byTier };
  }

  // ─── ADS ──────────────────────────────────────────────────────────────────

  async getAds(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [ads, total] = await Promise.all([
      this.prisma.advertisement.findMany({ skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.advertisement.count(),
    ]);
    return { ads, total };
  }

  async createAd(data: any) {
    return this.prisma.advertisement.create({ data });
  }

  async updateAd(id: string, data: any) {
    return this.prisma.advertisement.update({ where: { id }, data });
  }

  async toggleAd(id: string) {
    const ad = await this.prisma.advertisement.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException('Ad not found');
    return this.prisma.advertisement.update({ where: { id }, data: { isActive: !ad.isActive } });
  }

  async grantPremium(userId: string, tierName: string, days: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const tierMap: Record<string, { tier: number; name: string }> = {
      PREMIUM_BASIC: { tier: 1, name: 'PREMIUM_BASIC' },
      PREMIUM_STANDARD: { tier: 2, name: 'PREMIUM_STANDARD' },
      PREMIUM_MAX: { tier: 3, name: 'PREMIUM_MAX' },
    };
    const t = tierMap[tierName] || tierMap.PREMIUM_MAX;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        subscription: t.name as any,
        subscriptionEnd: endDate,
      },
    });

    await this.prisma.premiumSubscription.upsert({
      where: { userId },
      create: {
        userId,
        tier: t.tier,
        levelName: t.name,
        endDate,
        price: 0,
        currency: 'ADMIN_GRANT',
        status: 'active',
        paymentId: `admin_grant_${Date.now()}`,
        autoRenew: false,
      },
      update: {
        tier: t.tier,
        levelName: t.name,
        endDate,
        status: 'active',
        paymentId: `admin_grant_${Date.now()}`,
      },
    });

    this.logger.log(`Granted ${t.name} to user ${userId} for ${days} days`);
    return { success: true, subscription: t.name, endDate };
  }

  async createAdmin(email: string, password: string, displayName?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role === 'ADMIN' || existing.role === 'SUPERADMIN') {
        throw new ConflictException('User is already an admin');
      }
      const hash = await bcrypt.hash(password, 12);
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { role: 'ADMIN', passwordHash: hash, isVerified: true },
      });
      this.logger.log(`Promoted existing user ${email} to ADMIN`);
      return { success: true, email, role: 'ADMIN', message: 'Existing user promoted to ADMIN' };
    }

    const hash = await bcrypt.hash(password, 12);
    const username = email.split('@')[0] + '_admin';
    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        displayName: displayName || email.split('@')[0],
        passwordHash: hash,
        role: 'ADMIN',
        isVerified: true,
        preferences: { create: {} },
      },
    });
    this.logger.log(`Created new admin account: ${email}`);
    return { success: true, email, role: 'ADMIN', userId: user.id };
  }
}
