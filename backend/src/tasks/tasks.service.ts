import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdminService } from '../admin/admin.service';
import { TelegramService } from '../telegram/telegram.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { escapeTelegramHtml } from '../common/utils/telegram.util';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private admin: AdminService,
    private telegram: TelegramService,
    private config: ConfigService,
    private redis: RedisService,
  ) {}

  // Render's free plan spins the service down after ~15min of no inbound
  // traffic through its proxy; a request to our own localhost doesn't count
  // and won't stop that. Ping the public BACKEND_URL instead so the process
  // never idles long enough to sleep. This is what was causing Google login
  // to silently fail: NextAuth's backend token-exchange call would hit a
  // cold start, time out, and the frontend fell back to an unauthenticated
  // session on the map.
  @Cron('*/10 * * * *')
  async selfPing() {
    const backendUrl = this.config.get<string>('BACKEND_URL');
    if (!backendUrl) return;
    try {
      await fetch(`${backendUrl}/api/v1/health`);
    } catch (error) {
      this.logger.warn('Self-ping failed', error instanceof Error ? error.message : String(error));
    }
  }

  // Back to hourly, on the fixed clock hour.
  @Cron('0 * * * *', { timeZone: 'Asia/Tashkent' })
  async sendHourlyReport() {
    const chatId = this.config.get('TELEGRAM_CHAT_ID');
    if (!chatId) return;

    const now = new Date();
    const hourKey = now.toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });

    // A per-process in-memory flag can't prevent a duplicate send when two
    // instances briefly overlap during a redeploy (or the platform scales to
    // multiple replicas) — both start with a clean flag and both fire at the
    // same :00 tick. Redis SETNX makes the "already sent this run" check
    // shared across every instance. If Redis is unreachable, fail open (send
    // anyway) rather than silently going quiet for the run. TTL covers the
    // full 1h gap between runs so a late/retried tick within the same
    // window still dedupes.
    try {
      const acquired = await this.redis.setnx(`hourly-report:sent:${hourKey}`, '1', 3600);
      if (!acquired) {
        this.logger.debug(`Skipping report — already sent for ${hourKey}`);
        return;
      }
    } catch (error) {
      this.logger.warn(`Report dedup check failed, sending anyway: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const stats = await this.admin.getStats();
      const timeStr = now.toLocaleString('ru-RU', {
        timeZone: 'Asia/Tashkent',
        day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        timeZoneName: 'short',
      });

      let msg = `📊 <b>ЕЖЕЧАСНЫЙ ОТЧЁТ</b>\n🕐 ${timeStr}\n━━━━━━━━━━━━━━━\n`;
      msg += `📋 <b>РЕПОРТЫ</b>\n`;
      msg += `За час: ${stats.reports.hour}\n`;
      msg += `За день: ${stats.reports.day}\n`;
      msg += `За неделю: ${stats.reports.week}\n`;
      msg += `За месяц: ${stats.reports.month}\n\n`;

      msg += `💎 <b>PREMIUM (продаж)</b>\n`;
      msg += `Сегодня: ${stats.premium.today}\n`;
      msg += `За неделю: ${stats.premium.week}\n`;
      msg += `За месяц: ${stats.premium.month}\n\n`;

      msg += `🟢 <b>ОНЛАЙН</b>\n`;
      msg += `Сейчас: ${stats.online.count}\n`;
      if (stats.online.users.length > 0) {
        msg += stats.online.users.map((u: any) => `• ${escapeTelegramHtml(u.displayName || u.username)}`).join('\n');
      }
      msg += '\n\n';

      msg += `🖥 <b>СЕРВЕР</b>\n`;
      msg += `CPU: ${stats.server.cpu}%\n`;
      msg += `RAM: ${stats.server.memory}%\n`;

      await this.telegram.sendMessageToChat(+chatId, msg);
      this.logger.log(`Report sent (${timeStr})`);
    } catch (error) {
      this.logger.error('Failed to send report', error instanceof Error ? error.message : String(error));
    }
  }
}
