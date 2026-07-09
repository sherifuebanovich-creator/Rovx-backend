import { Controller, Post, Body, Logger } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { TelegramService } from './telegram.service';
import { AdminService } from '../admin/admin.service';

@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private telegram: TelegramService,
    private admin: AdminService,
  ) {}

  @Public()
  @Post('webhook')
  async webhook(@Body() body: any) {
    try {
      // Message with command
      if (body.message?.text) {
        const text = body.message.text.trim();
        const chatId = body.message.chat.id;
        const [cmd, ...args] = text.split(' ');

        if (cmd === '/stats') {
          await this.sendStats(chatId);
          return { ok: true };
        }

        if (cmd === '/start') {
          await this.telegram.sendMessageToChat(chatId,
            '🤖 <b>ROVX Bot</b>\n\n/stats — статистика системы\n/online — кто онлайн'
          );
          return { ok: true };
        }
      }

      // Callback query (inline button press)
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
        return { ok: true };
      }
    } catch (error) {
      this.logger.error('Telegram webhook error', error instanceof Error ? error.message : String(error));
    }
    return { ok: true };
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

      // Build inline buttons for recent premium purchases
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
