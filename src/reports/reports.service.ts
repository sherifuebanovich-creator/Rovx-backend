import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { GatewayService } from '../websocket/gateway.service';
import { TelegramService } from '../telegram/telegram.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const ReportType = {
  ACCIDENT: 'ACCIDENT',
  ROAD_CLOSURE: 'ROAD_CLOSURE',
  ROAD_WORKS: 'ROAD_WORKS',
  TRAFFIC_JAM: 'TRAFFIC_JAM',
  ICE: 'ICE',
  FOG: 'FOG',
  FLOODING: 'FLOODING',
  POLICE: 'POLICE',
  POTHOLE: 'POTHOLE',
  BAD_ROAD: 'BAD_ROAD',
  STRONG_WIND: 'STRONG_WIND',
  FREQUENT_ACCIDENTS: 'FREQUENT_ACCIDENTS',
  LANDSLIDE: 'LANDSLIDE',
  LOW_BRIDGE: 'LOW_BRIDGE',
  SHARP_TURN: 'SHARP_TURN',
  STEEP_CLIMB: 'STEEP_CLIMB',
  STEEP_DESCENT: 'STEEP_DESCENT',
  WEIGHT_LIMIT: 'WEIGHT_LIMIT',
  HEIGHT_LIMIT: 'HEIGHT_LIMIT',
  LENGTH_LIMIT: 'LENGTH_LIMIT',
  SPEED_CAMERA: 'SPEED_CAMERA',
  HAZARD: 'HAZARD',
  OTHER: 'OTHER',
} as const;
type ReportType = (typeof ReportType)[keyof typeof ReportType];

const ReportStatus = {
  ACTIVE: 'ACTIVE',
  CONFIRMED: 'CONFIRMED',
  EXPIRED: 'EXPIRED',
  REJECTED: 'REJECTED',
  RESOLVED: 'RESOLVED',
} as const;

const MAX_REPORTS_PER_USER = 3;
const REPORT_WINDOW_DAYS = 7;

const REPORT_TYPE_LABELS: Record<string, string> = {
  ACCIDENT: 'авария/ДТП',
  ROAD_CLOSURE: 'перекрытие дороги',
  ROAD_WORKS: 'дорожные работы',
  TRAFFIC_JAM: 'пробка',
  ICE: 'гололёд',
  FOG: 'туман',
  FLOODING: 'наводнение',
  POLICE: 'полиция',
  POTHOLE: 'яма на дороге',
  BAD_ROAD: 'плохая дорога',
  STRONG_WIND: 'сильный ветер',
  FREQUENT_ACCIDENTS: 'частые аварии',
  LANDSLIDE: 'оползень',
  LOW_BRIDGE: 'низкий мост',
  SHARP_TURN: 'крутой поворот',
  STEEP_CLIMB: 'крутой подъём',
  STEEP_DESCENT: 'крутой спуск',
  WEIGHT_LIMIT: 'ограничение веса',
  HEIGHT_LIMIT: 'ограничение высоты',
  LENGTH_LIMIT: 'ограничение длины',
  SPEED_CAMERA: 'камера скорости',
  HAZARD: 'опасность',
  OTHER: 'другое',
};

interface CreateReportDto {
  type: string;
  lat: number;
  lng: number;
  address?: string;
  description?: string;
  severity?: number;
  images?: string[];
  videos?: string[];
  city?: string;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly aiBaseUrl: string;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private gateway: GatewayService,
    private telegram: TelegramService,
    private config: ConfigService,
  ) {
    this.aiBaseUrl = this.config.get('AI_API_BASE_URL', 'https://api.groq.com/openai/v1');
  }

  private formatReport(report: any) {
    const parsed = { ...report };
    if (parsed.images && typeof parsed.images === 'string') {
      try { parsed.images = JSON.parse(parsed.images); } catch { parsed.images = []; }
    }
    if (parsed.videos && typeof parsed.videos === 'string') {
      try { parsed.videos = JSON.parse(parsed.videos); } catch { parsed.videos = []; }
    }
    return parsed;
  }

  private async checkReportLimit(userId: string): Promise<void> {
    const since = new Date(Date.now() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const activeCount = await this.prisma.report.count({
      where: {
        userId,
        createdAt: { gte: since },
        status: { in: [ReportStatus.ACTIVE, ReportStatus.CONFIRMED] },
      },
    });
    if (activeCount >= MAX_REPORTS_PER_USER) {
      throw new BadRequestException(
        `Лимит репортов: ${MAX_REPORTS_PER_USER} в неделю. Удалите старые или дождитесь истечения срока.`,
      );
    }
  }

  async validatePhoto(
    imageUrl: string,
    reportType?: string,
    description?: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    const apiKey = this.config.get('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('No AI API key, skipping photo validation');
      return { valid: true };
    }

    const typeLabel = reportType ? (REPORT_TYPE_LABELS[reportType] || reportType) : 'дорожная ситуация';

    let prompt: string;
    if (description && description.trim()) {
      prompt = `Проанализируй это изображение и определи, соответствует ли оно описанию события.

Описание: "${description}"

Тип события: "${typeLabel}"

Правила проверки:
- Если на фото видно то, что описано в тексте — ответь valid: true
- Если фото не связано с дорогой, транспортом или улицей (селфи, еда, животные, интерьер, природа без дорог) — valid: false
- Если на фото НЕ то, что описано в тексте (например, в описании "яма", а на фото авария) — valid: false с пояснением

Ответь JSON:
{
  "valid": boolean,
  "reason": "краткое пояснение на русском (до 100 символов)"
}

Будь строгим. Если фото не соответствует описанию — отклоняй.`;
    } else {
      prompt = `Проанализируй это изображение и определи, соответствует ли оно заявленному типу события.

Заявленный тип события: "${typeLabel}"

Правила проверки:
- Если на фото видно именно то, что указано в типе события — ответь valid: true
- Если фото не связано с дорогой, транспортом или улицей (селфи, еда, животные, интерьер, природа без дорог) — valid: false
- Если фото связано с дорогой/транспортом, но НЕ соответствует заявленному типу — valid: false с пояснением

Ответь JSON:
{
  "valid": boolean,
  "reason": "краткое пояснение на русском (до 100 символов)"
}

Будь строгим. Если на фото нет явных признаков заявленного типа события — отклоняй.`;
    }

    try {
      const response = await axios.post(
        `${this.aiBaseUrl}/chat/completions`,
        {
          model: this.config.get('AI_MODEL', 'llama-3.3-70b-versatile'),
          messages: [
            { role: 'system', content: 'You are a strict image moderation AI. Analyze images and respond in JSON only.' },
            { role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ]},
          ],
          temperature: 0.1,
          max_tokens: 200,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        },
      );

      const result = JSON.parse(response.data.choices[0].message.content);
      this.logger.log(`Photo validation for ${typeLabel}: ${result.valid ? 'ACCEPTED' : 'REJECTED'}`);

      if (!result.valid) {
        return { valid: false, reason: result.reason || 'Фото не соответствует заявленному типу события' };
      }
      return { valid: true };
    } catch (error) {
      this.logger.error('Photo validation failed', error instanceof Error ? error.message : String(error));
      return { valid: true };
    }
  }

  async validateDescription(description: string, reportType?: string): Promise<{ valid: boolean; reason?: string }> {
    const apiKey = this.config.get('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('No AI API key, skipping description validation');
      return { valid: true };
    }

    const typeLabel = reportType ? (REPORT_TYPE_LABELS[reportType] || reportType) : 'дорожная ситуация';

    const prompt = `Проанализируй это описание и определи, соответствует ли оно заявленному типу события.

Заявленный тип события: "${typeLabel}"

Описание: "${description}"

Правила проверки:
- Если описание соответствует типу события (например, для "яма на дороге" — описание про яму) — valid: true
- Если описание не связано с заявленным типом события (например, заявлено "авария", а описано про погоду) — valid: false
- Если описание содержит спам, рекламу или оскорбления — valid: false

Ответь JSON:
{
  "valid": boolean,
  "reason": "краткое пояснение на русском (до 100 символов)"
}`;

    try {
      const response = await axios.post(
        `${this.aiBaseUrl}/chat/completions`,
        {
          model: this.config.get('AI_MODEL', 'llama-3.3-70b-versatile'),
          messages: [
            { role: 'system', content: 'You are a strict content moderation AI. Respond in JSON only.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 200,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
      );

      const result = JSON.parse(response.data.choices[0].message.content);
      this.logger.log(`Description validation: ${result.valid ? 'ACCEPTED' : 'REJECTED'}`);

      if (!result.valid) {
        return { valid: false, reason: result.reason || 'Описание не соответствует заявленному типу' };
      }
      return { valid: true };
    } catch (error) {
      this.logger.error('Description validation failed', error instanceof Error ? error.message : String(error));
      return { valid: true };
    }
  }

  async getUsersInCity(city: string): Promise<string[]> {
    if (!city) return [];
    const lower = city.toLowerCase();
    const users = await this.prisma.user.findMany({
      where: { isActive: true, isBanned: false },
      select: { id: true, homeAddress: true, workAddress: true, city: true },
      take: 1000,
    });
    return users
      .filter(u =>
        (u.city && u.city.toLowerCase().includes(lower)) ||
        (u.homeAddress && u.homeAddress.toLowerCase().includes(lower)) ||
        (u.workAddress && u.workAddress.toLowerCase().includes(lower))
      )
      .map(u => u.id);
  }

  async getPremiumUsers(): Promise<string[]> {
    const now = new Date();
    const users = await this.prisma.user.findMany({
      where: {
        subscription: { not: 'FREE' },
        subscriptionEnd: { gt: now },
        isActive: true,
        isBanned: false,
      },
      select: { id: true },
    });
    return users.map(u => u.id);
  }

  private async getCityFromCoords(lat: number, lng: number): Promise<string | null> {
    try {
      const res = await axios.get(
        `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`,
        { timeout: 2000 },
      );
      const props = res.data.features?.[0]?.properties;
      return props?.city || props?.town || props?.village || props?.municipality || props?.county || null;
    } catch {
      return null;
    }
  }

  async createReport(userId: string, dto: CreateReportDto) {
    await this.checkReportLimit(userId);

    // AI validate photos against description
    if (dto.images && dto.images.length > 0) {
      for (const img of dto.images) {
        const validation = await this.validatePhoto(img, dto.type, dto.description);
        if (!validation.valid) {
          throw new BadRequestException(validation.reason || 'Фото не соответствует описанию');
        }
      }
    }

    // AI validate description
    if (dto.description && dto.description.trim()) {
      const descValidation = await this.validateDescription(dto.description, dto.type);
      if (!descValidation.valid) {
        throw new BadRequestException(descValidation.reason || 'Описание не соответствует заявленному типу');
      }
    }

    const ttlMap: Record<string, number> = {
      ACCIDENT: 4, ROAD_CLOSURE: 24, ROAD_WORKS: 168, TRAFFIC_JAM: 1,
      ICE: 8, FOG: 4, FLOODING: 12, POLICE: 2, POTHOLE: 720, BAD_ROAD: 720,
      STRONG_WIND: 6, FREQUENT_ACCIDENTS: 720, LANDSLIDE: 168,
      LOW_BRIDGE: 8760, SHARP_TURN: 8760, STEEP_CLIMB: 8760, STEEP_DESCENT: 8760,
      WEIGHT_LIMIT: 8760, HEIGHT_LIMIT: 8760, LENGTH_LIMIT: 8760,
      SPEED_CAMERA: 8760, HAZARD: 24, OTHER: 24,
    };

    const hoursToExpiry = ttlMap[dto.type] || 24;
    const expiresAt = new Date(Date.now() + hoursToExpiry * 60 * 60 * 1000);

    const report = await this.prisma.report.create({
      data: {
        userId,
        type: dto.type,
        lat: dto.lat,
        lng: dto.lng,
        address: dto.address,
        description: dto.description,
        severity: dto.severity || 3,
        images: JSON.stringify(dto.images || []),
        videos: JSON.stringify(dto.videos || []),
        expiresAt,
        status: ReportStatus.ACTIVE,
      },
      include: {
        user: { select: { id: true, displayName: true, avatar: true } },
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { reputation: { increment: 5 } },
    });

    // 1. Broadcast via WebSocket to nearby area
    await this.gateway.broadcastReport(report);

    // --- Common data for notifications ---
    const timeStr = new Date().toLocaleString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const typeLabel = REPORT_TYPE_LABELS[dto.type] || dto.type;
    const reportCity = dto.city || (await this.getCityFromCoords(dto.lat, dto.lng));

    // 2. Send to Telegram bot
    await this.telegram.sendReportNotification({
      type: dto.type,
      description: dto.description,
      lat: dto.lat,
      lng: dto.lng,
      severity: dto.severity || 3,
      images: dto.images,
      address: dto.address,
      city: reportCity || undefined,
      time: timeStr,
      userDisplayName: report.user?.displayName,
    });

    // 3. Send to all Premium users (tier 1+)
    const premiumUserIds = await this.getPremiumUsers();

    const notificationData = JSON.stringify({
      reportId: report.id,
      lat: dto.lat,
      lng: dto.lng,
      type: dto.type,
      images: dto.images,
      time: timeStr,
      address: dto.address,
      city: reportCity,
      severity: dto.severity || 3,
      description: dto.description,
    });

    for (const uid of premiumUserIds) {
      if (uid === userId) continue;
      const premiumNotif = await this.prisma.notification.create({
        data: {
          userId: uid,
          type: 'report_premium',
          title: `⚠️ ${typeLabel}`,
          body: dto.description || `Новый репорт: ${typeLabel}`,
          data: notificationData,
        },
      }).catch(() => null);
      if (premiumNotif) {
        await this.gateway.sendToUser(uid, 'notification:new', premiumNotif).catch(() => {});
      }
      await this.gateway.sendToUser(uid, 'report:new', {
        ...report,
        premiumNotification: true,
        time: timeStr,
      }).catch(() => {});
    }

    // 4. Send to users in the same city
    const city = reportCity;
    if (city) {
      const cityUserIds = await this.getUsersInCity(city);
      for (const uid of cityUserIds) {
        if (uid === userId || premiumUserIds.includes(uid)) continue;
        const cityNotif = await this.prisma.notification.create({
          data: {
            userId: uid,
            type: 'report',
            title: `⚠️ ${typeLabel} в ${city}`,
            body: dto.description || `Новое сообщение о "${typeLabel}" в ${city}`,
            data: notificationData,
          },
        }).catch(() => null);
        if (cityNotif) {
          await this.gateway.sendToUser(uid, 'notification:new', cityNotif).catch(() => {});
        }
        await this.gateway.sendToUser(uid, 'report:new', {
          ...report,
          cityNotification: true,
          time: timeStr,
        }).catch(() => {});
      }
      this.logger.log(`Sent city notifications to ${cityUserIds.length} users in ${city}`);
    }

    this.logger.log(`Report created: ${dto.type} by user ${userId}`);
    return this.formatReport(report);
  }

  async getReportsInArea(minLat: number, maxLat: number, minLng: number, maxLng: number, types?: string[]) {
    const now = new Date();
    const where: any = {
      status: { in: [ReportStatus.ACTIVE, ReportStatus.CONFIRMED] },
      lat: { gte: minLat, lte: maxLat },
      lng: { gte: minLng, lte: maxLng },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    if (types && types.length > 0) {
      where.type = { in: types };
    }
    const reports = await this.prisma.report.findMany({
      where,
      include: {
        user: { select: { id: true, displayName: true, reputation: true } },
        _count: { select: { votes: true } },
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    });
    return reports.map((r) => this.formatReport(r));
  }

  async getReportsForCity(city: string, page = 1, limit = 50) {
    if (!city) return { reports: [], total: 0 };
    const skip = (page - 1) * limit;
    const now = new Date();
    const lower = city.toLowerCase();
    const where = {
      status: { in: [ReportStatus.ACTIVE, ReportStatus.CONFIRMED] } as any,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      address: { contains: lower, mode: 'insensitive' as any },
    };
    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        include: {
          user: { select: { id: true, displayName: true, reputation: true, avatar: true } },
          _count: { select: { votes: true } },
        },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.report.count({ where }),
    ]);
    return { reports: reports.map((r) => this.formatReport(r)), total };
  }

  async getUserReportLimit(userId: string) {
    const since = new Date(Date.now() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const activeCount = await this.prisma.report.count({
      where: {
        userId,
        createdAt: { gte: since },
        status: { in: [ReportStatus.ACTIVE, ReportStatus.CONFIRMED] },
      },
    });
    return { used: activeCount, max: MAX_REPORTS_PER_USER, windowDays: REPORT_WINDOW_DAYS };
  }

  async voteReport(reportId: string, userId: string, isConfirm: boolean) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');

    await this.prisma.reportVote.upsert({
      where: { reportId_userId: { reportId, userId } },
      create: { reportId, userId, isConfirm },
      update: { isConfirm },
    });

    const votes = await this.prisma.reportVote.groupBy({
      by: ['isConfirm'],
      where: { reportId },
      _count: true,
    });

    const confirmed = votes.find((v) => v.isConfirm)?._count || 0;
    const rejected = votes.find((v) => !v.isConfirm)?._count || 0;

    let newStatus = report.status;
    if (confirmed >= 3) newStatus = ReportStatus.CONFIRMED;
    if (rejected >= 5) newStatus = ReportStatus.REJECTED;

    const confidence = confirmed + rejected > 0 ? confirmed / (confirmed + rejected) : 0.5;

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        confirmedBy: confirmed,
        rejectedBy: rejected,
        confidence,
        status: newStatus,
      },
    });

    if (newStatus === ReportStatus.CONFIRMED && report.status !== ReportStatus.CONFIRMED) {
      await this.prisma.user.update({
        where: { id: report.userId },
        data: { reputation: { increment: 10 } },
      });
    }

    return this.formatReport(updated);
  }

  async deleteReport(id: string, userId: string, userRole: string) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.userId !== userId && !['ADMIN', 'MODERATOR', 'SUPERADMIN'].includes(userRole)) {
      throw new ForbiddenException('Cannot delete this report');
    }
    await this.prisma.report.delete({ where: { id } });
    return { deleted: true };
  }

  async getReportsByUser(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.report.count({ where: { userId } }),
    ]);
    return { reports: reports.map((r) => this.formatReport(r)), total };
  }

  async expireReports() {
    const count = await this.prisma.report.updateMany({
      where: {
        status: { in: [ReportStatus.ACTIVE, ReportStatus.CONFIRMED] },
        expiresAt: { lt: new Date() },
      },
      data: { status: ReportStatus.EXPIRED },
    });
    this.logger.log(`Expired ${count.count} reports`);
  }
}
