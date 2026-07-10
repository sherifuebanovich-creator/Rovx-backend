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

    const visionModel = this.config.get('AI_VISION_MODEL', '');
    const model = visionModel || this.config.get('AI_MODEL', 'llama-3.3-70b-versatile');

    const supported = [
      ...(this.config.get<string>('AI_VISION_MODELS', '') || '').split(',').map(m => m.trim()).filter(Boolean),
      visionModel,
    ].filter(Boolean);

    if (supported.length > 0 && !supported.some(m => m === model || m.includes(model))) {
      this.logger.warn(`Model "${model}" not in vision-capable list [${supported.join(',')}], rejecting`);
      return { valid: false, reason: 'AI модель не поддерживает проверку фото' };
    }

    if (!model.includes('vision') && !model.includes('gpt-4o') && !model.includes('claude-3') && !model.includes('gpt-4.1') && !model.includes('llama')) {
      this.logger.warn(`Model "${model}" may not support vision, rejecting`);
      return { valid: false, reason: 'AI модель не поддерживает проверку фото' };
    }

    const typeLabel = reportType ? (REPORT_TYPE_LABELS[reportType] || reportType) : 'дорожная ситуация';

    const prompt = description?.trim()
      ? `Тип: "${typeLabel}". Описание: "${description}".
Проверь фото: есть ли на нём дорожная ситуация, соответствующая типу и описанию?
Фото ОДОБРЕНО (valid=true): на фото дорога/транспорт/ДТП/яма/погода на дороге, соответствующая типу.
Фото ОТКЛОНЕНО (valid=false): селфи, еда, животные, интерьер, природа без дороги, или фото не соответствует типу.
Ответ ТОЛЬКО JSON: {"valid":true/false,"reason":"причина на русском до 50 символов"}`
      : `Тип: "${typeLabel}".
Проверь фото: есть ли на нём дорожная ситуация, соответствующая этому типу?
Фото ОДОБРЕНО (valid=true): на фото дорога/транспорт/ДТП/яма/погода на дороге, соответствующая типу.
Фото ОТКЛОНЕНО (valid=false): селфи, еда, животные, интерьер, природа без дороги, или фото не соответствует типу.
Ответ ТОЛЬКО JSON: {"valid":true/false,"reason":"причина на русском до 50 символов"}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await axios.post(
          `${this.aiBaseUrl}/chat/completions`,
          {
            model,
            messages: [
              { role: 'system', content: 'Анализируй фото. Отвечай ТОЛЬКО валидным JSON без markdown и пояснений.' },
              { role: 'user', content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageUrl } },
              ]},
            ],
            temperature: 0.1,
            max_tokens: 150,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 20000,
          },
        );

        const raw = response.data.choices?.[0]?.message?.content || '';
        this.logger.debug(`AI response (attempt ${attempt + 1}): ${raw.slice(0, 200)}`);

        const parsed = this.extractJson(raw);
        if (parsed && typeof parsed.valid === 'boolean') {
          this.logger.log(`Photo validation [${typeLabel}]: ${parsed.valid ? 'ACCEPTED' : 'REJECTED'} — ${String(parsed.reason || '')}`);
          return parsed.valid
            ? { valid: true }
            : { valid: false, reason: String(parsed.reason || 'Фото не соответствует типу') };
        }

        this.logger.warn(`AI returned non-parseable response (attempt ${attempt + 1}): ${raw.slice(0, 300)}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (axios.isAxiosError(error) && error.response?.status) {
          this.logger.error(`AI API error ${error.response.status}: ${msg}`);
        } else {
          this.logger.error(`AI request failed (attempt ${attempt + 1}): ${msg}`);
        }
        if (attempt === 0) continue;
        return { valid: true };
      }
    }

    this.logger.warn('AI returned unparseable JSON after 2 attempts, accepting photo (fail-open)');
    return { valid: true };
  }

  private extractJson(raw: string): Record<string, unknown> | null {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {}
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return null;
  }

  async validateDescription(description: string, reportType?: string): Promise<{ valid: boolean; reason?: string }> {
    const apiKey = this.config.get('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('No AI API key, skipping description validation');
      return { valid: true };
    }

    const typeLabel = reportType ? (REPORT_TYPE_LABELS[reportType] || reportType) : 'дорожная ситуация';

    const prompt = `Проанализируй описание дорожного события и определи, соответствует ли оно заявленному типу.

Заявленный тип события: "${typeLabel}"

Описание: "${description}"

Правила проверки (строгие):
- Описание должно относиться к российской дорожной ситуации
- Для POTHOLE/BAD_ROAD — описание про ямы, выбоины, разрушенное покрытие
- Для ACCIDENT — описание про ДТП, столкновение, аварию
- Для ICE — описание про лёд, гололёд, скользкую дорогу
- Для FOG — описание про туман, плохую видимость
- Для POLICE — описание про патруль ДПС, полицейскую машину, пост ГИБДД
- Для ROAD_WORKS — описание про ремонт дороги, дорожные работы, строительную технику
- Если описание не соответствует заявленному типу — valid: false
- Если описание содержит спам, рекламу или оскорбления — valid: false
- Если описание не относится к дорожной ситуации — valid: false

Ответь JSON:
{
  "valid": boolean,
  "reason": "краткое пояснение на русском (до 100 символов)"
}

Будь строгим. Отклоняй несоответствующие и подозрительные описания.`;

    try {
      const response = await axios.post(
        `${this.aiBaseUrl}/chat/completions`,
        {
          model: this.config.get('AI_MODEL', 'llama-3.3-70b-versatile'),
          messages: [
            { role: 'system', content: 'You are a strict content moderation AI for Russian road reports. Respond in JSON only.' },
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

      const content = response.data.choices?.[0]?.message?.content;
      if (!content) {
        this.logger.warn('Description validation: empty response from AI');
        return { valid: true };
      }

      const result = JSON.parse(content);
      this.logger.log(`Description validation: ${result.valid ? 'ACCEPTED' : 'REJECTED'}`);

      if (!result.valid) {
        return { valid: false, reason: result.reason || 'Описание не соответствует заявленному типу' };
      }
      return { valid: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Description validation error: ${msg}`);
      return { valid: true };
    }
  }

  async getUsersInCity(city: string): Promise<string[]> {
    if (!city) return [];
    const lower = city.toLowerCase();

    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        isBanned: false,
        OR: [
          { city: { contains: lower, mode: 'insensitive' } },
          { homeAddress: { contains: lower, mode: 'insensitive' } },
          { workAddress: { contains: lower, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    return users.map(u => u.id);
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

    // AI validate photos against description (parallel)
    if (dto.images && dto.images.length > 0) {
      const results = await Promise.all(
        dto.images.map(img => this.validatePhoto(img, dto.type, dto.description)),
      );
      for (const validation of results) {
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

    // --- Common data for notifications ---
    const timeStr = new Date().toLocaleString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const typeLabel = REPORT_TYPE_LABELS[dto.type] || dto.type;
    const reportCity = dto.city || (await this.getCityFromCoords(dto.lat, dto.lng).catch(() => null));

    // Background notifications (don't block response)
    this.sendReportNotifications(report, dto, userId, typeLabel, timeStr, reportCity).catch(e =>
      this.logger.error('Background notifications failed', e),
    );

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

  private async sendReportNotifications(report: any, dto: CreateReportDto, userId: string, typeLabel: string, timeStr: string, reportCity: string | null) {
    // 1. Broadcast via WebSocket to nearby area
    await this.gateway.broadcastReport(report).catch(() => {});

    // 2. Send to all Premium users (tier 1+)
    const premiumUserIds = await this.getPremiumUsers().catch(() => []);

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

    // 4. Emit to city room for real-time delivery (users subscribed via city:subscribe)
    const city = reportCity;
    if (city) {
      const cityRoom = `city:${city.toLowerCase()}`;
      this.gateway.emitToRoom(cityRoom, 'report:new', {
        ...report,
        cityNotification: true,
        time: timeStr,
        city,
      });

      // 5. Send to users in the same city
      const cityUserIds = await this.getUsersInCity(city).catch(() => []);
      const uniqueIds = [...new Set(cityUserIds.filter(uid => uid !== userId && !premiumUserIds.includes(uid)))];
      if (uniqueIds.length > 0) {
        await this.prisma.notification.createMany({
          data: uniqueIds.map(uid => ({
            userId: uid,
            type: 'report' as const,
            title: `⚠️ ${typeLabel} в ${city}`,
            body: dto.description || `Новое сообщение о "${typeLabel}" в ${city}`,
            data: notificationData,
          })),
        }).catch(e => this.logger.error('Failed to batch-create city notifications', e));

        for (const uid of uniqueIds) {
          await this.gateway.sendToUser(uid, 'report:new', {
            ...report,
            cityNotification: true,
            time: timeStr,
          }).catch(() => {});
        }
      }
      this.logger.log(`Sent city notifications to ${uniqueIds.length} users in ${city}`);
    }
  }
}
