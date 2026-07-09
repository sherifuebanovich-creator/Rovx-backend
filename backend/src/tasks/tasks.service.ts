import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdminService } from '../admin/admin.service';
import { TelegramService } from '../telegram/telegram.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private admin: AdminService,
    private telegram: TelegramService,
    private config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendHourlyReport() {
    const chatId = this.config.get('TELEGRAM_CHAT_ID');
    if (!chatId) return;

    try {
      const stats = await this.admin.getStats();
      const now = new Date().toLocaleString('ru-RU', {
        day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      });

      let msg = `📊 <b>ЕЖЕЧАСНЫЙ ОТЧЁТ</b>\n🕐 ${now}\n━━━━━━━━━━━━━━━\n`;
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
        msg += stats.online.users.map((u: any) => `• ${u.displayName || u.username}`).join('\n');
      }
      msg += '\n\n';

      msg += `🖥 <b>СЕРВЕР</b>\n`;
      msg += `CPU: ${stats.server.cpu}%\n`;
      msg += `RAM: ${stats.server.memory}%\n`;

      await this.telegram.sendMessageToChat(+chatId, msg);
      this.logger.log('Hourly report sent to Telegram');
    } catch (error) {
      this.logger.error('Failed to send hourly report', error instanceof Error ? error.message : String(error));
    }
  }
}
