import { Controller, Post, Body, Logger } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { TelegramService } from './telegram.service';
import { AdminService } from '../admin/admin.service';
import { ReportsService } from '../reports/reports.service';

const BOT_PASSWORD = 'claudepro';

const COUNTRIES: Record<string, string[]> = {
  'Россия': ['Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань', 'Краснодар', 'Сочи', 'Ростов-на-Дону', 'Уфа', 'Красноярск', 'Воронеж', 'Пермь', 'Волгоград', 'Самара', 'Нижний Новгород', 'Челябинск', 'Омск', 'Тюмень', 'Иркутск', 'Хабаровск'],
  'Узбекистан': ['Ташкент', 'Самарканд', 'Бухара', 'Наманган', 'Андижан', 'Фергана', 'Нукус', 'Карши', 'Джизак', 'Ургенч'],
  'Казахстан': ['Алматы', 'Астана', 'Шымкент', 'Караганда', 'Актау', 'Атырау'],
  'Украина': ['Киев', 'Харьков', 'Одесса', 'Днепр', 'Львов', 'Запорожье'],
  'Беларусь': ['Минск', 'Гомель', 'Брест', 'Витебск', 'Гродно', 'Могилёв'],
  'Азербайджан': ['Баку', 'Гянджа', 'Сумгаит', 'Мингечаур'],
  'Армения': ['Ереван', 'Гюмри', 'Ванадзор', 'Раздан'],
  'Кыргызстан': ['Бишкек', 'Ош', 'Джалал-Абад', 'Каракол'],
  'Таджикистан': ['Душанбе', 'Худжанд', 'Куляб', 'Бохтар'],
  'Туркменистан': ['Ашхабад', 'Туркменабад', 'Дашогуз'],
  'Молдова': ['Кишинёв', 'Бельцы', 'Тирасполь'],
};

const TYPE_EMOJI: Record<string, string> = {
  ACCIDENT: '💥', POLICE: '👮', ROAD_WORKS: '🚧', ICE: '🧊',
  FOG: '🌫', FLOODING: '🌊', POTHOLE: '🕳', BAD_ROAD: '🛣',
  TRAFFIC_JAM: '🚗', ROAD_CLOSURE: '🚫', SPEED_CAMERA: '📷',
  HAZARD: '⚠️', STRONG_WIND: '💨', LANDSLIDE: '⛰',
  LOW_BRIDGE: '⬇', SHARP_TURN: '↪', STEEP_CLIMB: '⤴',
  STEEP_DESCENT: '⤵', WEIGHT_LIMIT: '⚖', HEIGHT_LIMIT: '📏',
  LENGTH_LIMIT: '📐', OTHER: '📌',
};

@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);
  private readonly authorizedChats = new Set<number>();

  constructor(
    private telegram: TelegramService,
    private admin: AdminService,
    private reports: ReportsService,
  ) {}

  private isAuthorized(chatId: number): boolean {
    return this.authorizedChats.has(chatId);
  }

  private async sendMenu(chatId: number) {
    await this.telegram.sendMessageToChat(chatId,
      '🤖 <b>ROVX Bot</b>\n\n' +
      '📋 /reports — репорты по городам\n' +
      '🟢 /online — кто сейчас онлайн\n' +
      '💎 /premium — продажи премиума\n' +
      '🖥 /server — нагрузка сервера\n' +
      '🚪 /logout — выйти');
  }

  @Public()
  @Post('webhook')
  async webhook(@Body() body: any) {
    try {
      if (body.message?.text) {
        const text = body.message.text.trim();
        const chatId = body.message.chat.id;
        const [cmd] = text.split(' ');

        if (cmd === '/start') {
          if (this.isAuthorized(chatId)) {
            await this.sendMenu(chatId);
          } else {
            await this.telegram.sendMessageToChat(chatId,
              '🔐 <b>Доступ закрыт</b>\n\nВведите пароль для доступа к боту:');
          }
          return { ok: true };
        }

        if (cmd === '/logout') {
          this.authorizedChats.delete(chatId);
          await this.telegram.sendMessageToChat(chatId, '🚪 Вы вышли. Введите пароль для доступа:');
          return { ok: true };
        }

        if (!this.isAuthorized(chatId)) {
          if (text === BOT_PASSWORD) {
            this.authorizedChats.add(chatId);
            await this.telegram.sendMessageToChat(chatId, '✅ <b>Добро пожаловать!</b>');
            await this.sendMenu(chatId);
          } else {
            await this.telegram.sendMessageToChat(chatId, '❌ Неверный пароль');
          }
          return { ok: true };
        }

        if (cmd === '/reports') {
          const countryButtons = Object.keys(COUNTRIES).map(c => ({
            text: `🌍 ${c}`, callback_data: `country_${c}`,
          }));
          await this.telegram.sendMessageToChat(chatId,
            '🌍 <b>Выбери страну</b>', countryButtons);
          return { ok: true };
        }

        if (cmd === '/online') {
          await this.sendOnline(chatId);
          return { ok: true };
        }

        if (cmd === '/premium') {
          await this.sendPremium(chatId);
          return { ok: true };
        }

        if (cmd === '/server') {
          await this.sendServer(chatId);
          return { ok: true };
        }
      }

      if (body.callback_query) {
        const data = body.callback_query.data;
        const cbId = body.callback_query.id;
        const chatId = body.callback_query.message?.chat?.id;

        if (chatId && !this.isAuthorized(chatId)) {
          await this.telegram.answerCallbackQuery(cbId, '🔒 Нужна авторизация');
          return { ok: true };
        }

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

        if (data?.startsWith('country_')) {
          const country = decodeURIComponent(data.replace('country_', ''));
          const cities = COUNTRIES[country] || [];
          await this.telegram.answerCallbackQuery(cbId, `🏙 ${country}`);
          const cityButtons = cities.map(c => ({
            text: `📍 ${c}`, callback_data: `city_${c}`,
          }));
          if (chatId) {
            await this.telegram.sendMessageToChat(chatId,
              `🌍 <b>${country}</b>\n\nВыбери город:`, cityButtons);
          }
        }

        if (data?.startsWith('city_')) {
          const city = decodeURIComponent(data.replace('city_', ''));
          if (chatId) {
            await this.telegram.answerCallbackQuery(cbId, `🏙 ${city}`);
            await this.sendCityReports(chatId, city);
          }
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

      await this.telegram.sendMessageToChat(chatId, `🏙 <b>${city}</b> — ${reports.length} репортов\nОтправляю детали...`);

      for (const r of reports.slice(0, 10)) {
        const emoji = TYPE_EMOJI[r.type] || '📌';
        const time = r.createdAt ? new Date(r.createdAt).toLocaleString('ru-RU', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        }) : '—';
        const severityBar = '🔴'.repeat(Math.min(r.severity || 3, 5)) + '⚪'.repeat(5 - Math.min(r.severity || 3, 5));
        const mapLink = `https://www.google.com/maps?q=${r.lat},${r.lng}`;
        const name = r.user?.displayName || '—';

        let caption = `${emoji} <b>${r.type}</b>\n`;
        caption += `━━━━━━━━━━━━━━━\n`;
        caption += `🕐 <b>Время:</b> ${time}\n`;
        caption += `⚠️ <b>Серьёзность:</b> ${severityBar} (${r.severity}/5)\n`;
        caption += `📍 <b>Координаты:</b> ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}\n`;
        caption += `🗺 <a href="${mapLink}">Открыть на карте</a>\n`;
        if (r.address) caption += `📮 <b>Адрес:</b> ${r.address}\n`;
        if (r.description) caption += `📝 <b>Описание:</b> ${r.description}\n`;
        caption += `━━━━━━━━━━━━━━━\n`;
        caption += `👤 <b>Автор:</b> ${name}`;

        const images = Array.isArray(r.images) ? r.images : [];
        if (images.length > 0) {
          await this.telegram.sendPhotoToChat(chatId, images[0], caption);
        } else {
          await this.telegram.sendMessageToChat(chatId, caption);
        }
      }

      if (reports.length > 10) {
        await this.telegram.sendMessageToChat(chatId,
          `📋 Показано 10 из ${reports.length} репортов.`);
      }
    } catch (error) {
      this.logger.error('Failed to send city reports', error instanceof Error ? error.message : String(error));
      await this.telegram.sendMessageToChat(chatId, `❌ Ошибка при получении репортов для ${city}`);
    }
  }

  private async sendPremium(chatId: number) {
    try {
      const stats = await this.admin.getStats();
      const msg = `💎 <b>PREMIUM (продаж)</b>\n` +
        `Сегодня: ${stats.premium.today}\n` +
        `За неделю: ${stats.premium.week}\n` +
        `За месяц: ${stats.premium.month}\n`;
      const buttons = stats.premium.details.slice(0, 10).map((sub: any) => ({
        text: `📦 ${sub.user.displayName || sub.user.username} — $${sub.price}`,
        callback_data: `premium_${sub.id}`,
      }));
      await this.telegram.sendMessageToChat(chatId, msg, buttons);
    } catch (error) {
      this.logger.error('Failed to send premium', error instanceof Error ? error.message : String(error));
      await this.telegram.sendMessageToChat(chatId, '❌ Ошибка при получении статистики премиума');
    }
  }

  private async sendServer(chatId: number) {
    try {
      const stats = await this.admin.getStats();
      const msg = `🖥 <b>СЕРВЕР</b>\n` +
        `CPU: ${stats.server.cpu}%\n` +
        `RAM: ${stats.server.memory}%\n`;
      await this.telegram.sendMessageToChat(chatId, msg);
    } catch (error) {
      this.logger.error('Failed to send server', error instanceof Error ? error.message : String(error));
      await this.telegram.sendMessageToChat(chatId, '❌ Ошибка при получении данных сервера');
    }
  }

  private async sendOnline(chatId: number) {
    try {
      const stats = await this.admin.getStats();
      const users = stats.online.users || [];
      let msg = `🟢 <b>ОНЛАЙН (${stats.online.count})</b>\n━━━━━━━━━━━━━━━\n`;
      if (users.length === 0) {
        msg += 'Никого нет онлайн';
      } else {
        for (const u of users) {
          const name = u.displayName || u.username || '—';
          const city = u.city ? ` 🏙 ${u.city}` : '';
          msg += `• ${name}${city}\n`;
        }
      }
      await this.telegram.sendMessageToChat(chatId, msg);
    } catch (error) {
      this.logger.error('Failed to send online', error instanceof Error ? error.message : String(error));
      await this.telegram.sendMessageToChat(chatId, '❌ Ошибка при получении списка онлайн');
    }
  }
}
