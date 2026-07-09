import { Controller, Post, Body, Logger } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { TelegramService } from './telegram.service';
import { AdminService } from '../admin/admin.service';
import { ReportsService } from '../reports/reports.service';

const POPULAR_CITIES = ['Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань', 'Краснодар', 'Сочи', 'Ростов-на-Дону'];

@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private telegram: TelegramService,
    private admin: AdminService,
    private reports: ReportsService,
  ) {}

  @Public()
  @Post('webhook')
  async webhook(@Body() body: any) {
    try {
      if (body.message?.text) {
        const text = body.message.text.trim();
        const chatId = body.message.chat.id;
        const [cmd, ...args] = text.split(' ');

        if (cmd === '/stats') {
          await this.sendStats(chatId);
          return { ok: true };
        }

        if (cmd === '/reports') {
          const city = args.join(' ');
          if (city) {
            await this.sendCityReports(chatId, city);
          } else {
            const buttons = POPULAR_CITIES.map(c => ({ text: c, callback_data: `city_${c}` }));
            await this.telegram.sendMessageToChat(chatId,
              '🏙 <b>Введи город</b>\nНапример: /reports Москва\n\nИли выбери:', buttons);
          }
          return { ok: true };
        }

        if (cmd === '/start') {
          await this.telegram.sendMessageToChat(chatId,
            '🤖 <b>ROVX Bot</b>\n\n/stats — статистика системы\n/reports — репорты по городу');
          return { ok: true };
        }
      }

      if (body.callback_query) {
        const data = body.callback_query.data;
        const cbId = body.callback_query.id;
        const chatId = body.callback_query.message?.chat?.id;

        if (data?.startsWith('premium_')) {
          const id = data.replace('premium_', '');
          try {
            const sub = await this.admin.getPremiumDetail(id);
            const msg = `📦 <b>Premium</b>\n` +
              `👤 Покупатель: ${sub.user.displayName || sub.user.username}\n` +
              `📧 ${sub.user.email}\n` +
              `🏷 Тариф: ${sub.levelName}\n` +
              `💰 Цена: $${sub.price}\n` +
              `🕐 Куплен: ${sub.createdAt.toISOString().slice(0, 16)}\n` +
              `📅 Действует до: ${sub.endDate.toISOString().slice(0, 10)}\n` +
              `🆔 ID: ${sub.id.slice(0, 8)}...`;
            await this.telegram.answerCallbackQuery(cbId, msg);
          } catch {
            await this.telegram.answerCallbackQuery(cbId, '❌ Премиум не найден');
          }
        }

        if (data?.startsWith('city_')) {
          const city = decodeURIComponent(data.replace('city_', ''));
          if (chatId) await this.sendCityReports(chatId, city);
        }

        return { ok: true };
      }
    } catch (error) {
      this.logger.error('Telegram webhook error', error instanceof Error ? error.message : String(error));
    }
    return { ok: true };
  }

  private async sendCityReports(chatId: number, city: string) {
    try {
      const res = await this.reports.getReportsForCity(city, 1, 20);
      const reports = res.reports || [];
      if (!reports.length) {
        await this.telegram.sendMessageToChat(chatId, `🏙 <b>${city}</b>\n\nНет активных репортов`);
        return;
      }

      const typeEmoji: Record<string, string> = {
        ACCIDENT: '💥', POLICE: '👮', ROAD_WORKS: '🚧', ICE: '🧊',
        FOG: '🌫', FLOODING: '🌊', POTHOLE: '🕳', BAD_ROAD: '🛣',
        TRAFFIC_JAM: '🚗', ROAD_CLOSURE: '🚫',
      };

      let msg = `🏙 <b>${city}</b> — ${reports.length} репортов\n━━━━━━━━━━━━━━━\n`;
      for (const r of reports.slice(0, 20)) {
        const emoji = typeEmoji[r.type] || '📌';
        const time = r.createdAt ? new Date(r.createdAt).toLocaleString('ru-RU', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        }) : '—';
        msg += `${emoji} <b>${r.type}</b>\n`;
        msg += `🕐 ${time}\n`;
        if (r.description) msg += `📝 ${r.description.slice(0, 80)}\n`;
        if (r.user?.displayName) msg += `👤 ${r.user.displayName}\n`;
        msg += `━━━━━━━━━━━━━━━\n`;
      }

      await this.telegram.sendMessageToChat(chatId, msg);
    } catch (error) {
      this.logger.error('Failed to send city reports', error instanceof Error ? error.message : String(error));
      await this.telegram.sendMessageToChat(chatId, `❌ Ошибка при получении репортов для ${city}`);
    }
  }

  private async sendStats(chatId: number) {
    try {
      const stats = await this.admin.getStats();

      const reportsLine = `📊 <b>РЕПОРТЫ</b>\n` +
        `За час: ${stats.reports.hour}\n` +
        `За день: ${stats.reports.day}\n` +
        `За неделю: ${stats.reports.week}\n` +
        `За месяц: ${stats.reports.month}\n`;

      const premiumLine = `💎 <b>PREMIUM (продаж)</b>\n` +
        `Сегодня: ${stats.premium.today}\n` +
        `За неделю: ${stats.premium.week}\n` +
        `За месяц: ${stats.premium.month}\n`;

      const onlineLine = `🟢 <b>ОНЛАЙН</b>\n` +
        `Всего: ${stats.online.count}\n` +
        (stats.online.users.length > 0
          ? stats.online.users.map((u: any) => `• ${u.displayName || u.username}`).join('\n')
          : '—') + '\n';

      const serverLine = `🖥 <b>СЕРВЕР</b>\n` +
        `CPU: ${stats.server.cpu}%\n` +
        `RAM: ${stats.server.memory}%\n`;

      const msg = `${reportsLine}\n${premiumLine}\n${onlineLine}\n${serverLine}`;

      const buttons = stats.premium.details.slice(0, 10).map((sub: any) => ({
        text: `📦 ${sub.user.displayName || sub.user.username} — $${sub.price}`,
        callback_data: `premium_${sub.id}`,
      }));

      await this.telegram.sendMessageToChat(chatId, msg, buttons);
    } catch (error) {
      this.logger.error('Failed to send stats', error instanceof Error ? error.message : String(error));
      await this.telegram.sendMessageToChat(chatId, '❌ Ошибка при получении статистики');
    }
  }
}
