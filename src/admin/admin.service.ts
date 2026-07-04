import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
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

  async banUser(id: string, reason: string) {
    return this.prisma.user.update({
      where: { id },
      data: { isBanned: true, bannedReason: reason, isActive: false },
    });
  }

  async unbanUser(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { isBanned: false, bannedReason: null, isActive: true },
    });
  }

  async updateUserRole(id: string, role: string) {
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
}
