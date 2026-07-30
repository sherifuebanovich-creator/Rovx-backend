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
    // `page`/`limit` come straight from `+query` in the controller — a
    // non-numeric value makes them NaN, which the existing Math.max(0, ...)
    // clamp (added for negative/zero page) doesn't catch since NaN survives
    // Math.max unchanged and would reach Prisma's skip/take as NaN. `limit`
    // was also completely unbounded, unlike every other capped list endpoint.
    page = Number.isFinite(page) && page > 0 ? page : 1;
    limit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const skip = Math.max(0, (page - 1) * limit);
    const where: any = {};
    if (search) {
      // Every other search in the app (groups, group search, join-by-name)
      // is case-insensitive — this one wasn't, so an admin looking up
      // "Ivan" got zero results for a user stored as "ivan".
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
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
    // The ban itself already committed — a socket-adapter hiccup here must
    // not turn a successful ban into a 500 that tells the admin it failed
    // (the user is banned either way; they just stay connected a bit
    // longer if this best-effort disconnect fails).
    try {
      await this.gatewayService.disconnectUser(id);
    } catch (e) {
      this.logger.warn(`Failed to disconnect banned user ${id}: ${(e as Error).message}`);
    }
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
    // See getUsers above — NaN page/limit isn't caught by Math.max(0, ...).
    page = Number.isFinite(page) && page > 0 ? page : 1;
    limit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const skip = Math.max(0, (page - 1) * limit);
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
    // See getUsers above — NaN page/limit isn't caught by Math.max(0, ...).
    page = Number.isFinite(page) && page > 0 ? page : 1;
    limit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const skip = Math.max(0, (page - 1) * limit);
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

  private static readonly MAP_OBJECT_FIELDS = [
    'category', 'name', 'description', 'lat', 'lng', 'address', 'phone',
    'website', 'openHours', 'amenities', 'images', 'rating', 'reviewCount',
    'isVerified', 'isActive', 'isPremium', 'data',
  ] as const;

  private pickMapObjectFields(data: any): any {
    const picked: Record<string, any> = {};
    for (const field of AdminService.MAP_OBJECT_FIELDS) {
      if (data[field] !== undefined) picked[field] = data[field];
    }
    return picked;
  }

  async createMapObject(data: any) {
    // Cast: pickMapObjectFields whitelists fields but can't statically prove
    // the required ones (category/name/lat/lng) were present — same trust
    // boundary as this method's `data: any` param (admin-only, unchanged).
    return this.prisma.mapObject.create({ data: this.pickMapObjectFields(data) });
  }

  async updateMapObject(id: string, data: any) {
    // Was `data` passed straight through — a request body containing `id`
    // silently changed the row's primary key on update. Bookmark.mapObjectId
    // /Review.mapObjectId have no onDelete/onUpdate: Cascade, so any existing
    // bookmark/review pointing at the old id became a dangling reference
    // with no matching MapObject.
    return this.prisma.mapObject.update({ where: { id }, data: this.pickMapObjectFields(data) });
  }

  async deleteMapObject(id: string) {
    try {
      await this.prisma.mapObject.delete({ where: { id } });
    } catch (err: any) {
      // Bookmark.mapObjectId/Review.mapObjectId have no onDelete: Cascade —
      // deleting an object users have bookmarked/reviewed throws a raw FK
      // violation (P2003) that the global filter would render as a bare
      // "Internal server error", giving the admin no clue why the delete
      // silently failed.
      if (err?.code === 'P2003') {
        throw new BadRequestException('Нельзя удалить: объект используется в закладках или отзывах пользователей');
      }
      throw err;
    }
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
    // See getUsers above — NaN page/limit isn't caught by Math.max(0, ...).
    page = Number.isFinite(page) && page > 0 ? page : 1;
    limit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const skip = Math.max(0, (page - 1) * limit);
    const [ads, total] = await Promise.all([
      this.prisma.advertisement.findMany({ skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.advertisement.count(),
    ]);
    return { ads, total };
  }

  // Same defect class the comments on updateMapObject/createMapObject above
  // already describe as fixed there — this model never got the same
  // whitelist, so a body containing `id` (or `spent`/`impressions`/`clicks`,
  // which should only ever be server-incremented) passed straight to Prisma
  // could repoint the row's primary key or let an admin request silently
  // overwrite counters it has no business setting directly.
  private static readonly AD_FIELDS = [
    'partnerId', 'title', 'description', 'imageUrl', 'clickUrl', 'category',
    'lat', 'lng', 'radius', 'budget', 'isActive', 'startsAt', 'endsAt',
  ] as const;

  private pickAdFields(data: any): any {
    const picked: Record<string, any> = {};
    for (const field of AdminService.AD_FIELDS) {
      if (data[field] !== undefined) picked[field] = data[field];
    }
    return picked;
  }

  async createAd(data: any) {
    return this.prisma.advertisement.create({ data: this.pickAdFields(data) });
  }

  async updateAd(id: string, data: any) {
    return this.prisma.advertisement.update({ where: { id }, data: this.pickAdFields(data) });
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
    // Was `tierMap[tierName] || tierMap.PREMIUM_MAX` — a typo'd/unrecognized
    // tier name silently granted the most generous tier instead of erroring,
    // so an operator's typo (e.g. "PREMIUM_STANDART") gave a user PREMIUM_MAX
    // for free with no indication anything was wrong.
    const t = tierMap[tierName];
    if (!t) {
      throw new BadRequestException(`Unknown tier "${tierName}". Valid: ${Object.keys(tierMap).join(', ')}`);
    }
    if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) {
      throw new BadRequestException('days must be a positive number');
    }

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    // Was two independent writes — if the second one threw (race, DB blip),
    // the user was left with User.subscription flipped to premium but no
    // backing PremiumSubscription row, desyncing anything that reads the
    // latter (billing/renewal jobs, admin stats).
    const paymentId = `admin_grant_${Date.now()}`;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          subscription: t.name as any,
          subscriptionEnd: endDate,
        },
      }),
      this.prisma.premiumSubscription.upsert({
        where: { userId },
        create: {
          userId,
          tier: t.tier,
          levelName: t.name,
          endDate,
          price: 0,
          currency: 'ADMIN_GRANT',
          status: 'active',
          paymentId,
          autoRenew: false,
        },
        update: {
          tier: t.tier,
          levelName: t.name,
          endDate,
          status: 'active',
          paymentId,
        },
      }),
    ]);

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
