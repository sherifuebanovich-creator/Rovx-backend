import { Controller, Post, Body, Logger, OnModuleInit } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { TelegramService } from './telegram.service';
import { AdminService } from '../admin/admin.service';
import { ReportsService } from '../reports/reports.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

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

const AUTH_REDIS_KEY = 'telegram:auth:chats';

@Controller('telegram')
export class TelegramController implements OnModuleInit {
  private readonly logger = new Logger(TelegramController.name);
  private readonly authorizedChats = new Set<number>();

  constructor(
    private telegram: TelegramService,
    private admin: AdminService,
    private reports: ReportsService,
    private config: ConfigService,
    private redis: RedisService,
  ) {}

  async onModuleInit() {
    try {
      const ids = await this.redis.smembers(AUTH_REDIS_KEY);
      for (const id of ids) {
        this.authorizedChats.add(Number(id));
      }
      this.logger.log(`Loaded ${ids.length} authorized Telegram chats from Redis`);
    } catch {}
  }

  private isAuthorized(chatId: number): boolean {
    return this.authorizedChats.has(chatId);
  }

  private async authorizeChat(chatId: number) {
    this.authorizedChats.add(chatId);
    await this.redis.sadd(AUTH_REDIS_KEY, String(chatId));
  }

  private async deauthorizeChat(chatId: number) {
    this.authorizedChats.delete(chatId);
    await this.redis.srem(AUTH_REDIS_KEY, String(chatId));
  }

  private async sendMenu(chatId: number) {
    await this.telegram.sendMessageToChat(chatId,
      '🤖 <b>ROVX Bot</b>\n\n' +
      '📋 /reports — репорты по городам\n' +
      '🔍 /search <город> — поиск репортов\n' +
      '🔎 /report <id> — детали репорта\n' +
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
          await this.deauthorizeChat(chatId);
          await this.telegram.sendMessageToChat(chatId, '🚪 Вы вышли. Введите пароль для доступа:');
          return { ok: true };
        }

        if (!this.isAuthorized(chatId)) {
          const botPassword = this.config.get('TELEGRAM_BOT_PASSWORD');
          if (!botPassword) {
            await this.telegram.sendMessageToChat(chatId, '❌ Bot not configured');
            return { ok: true };
          }
          if (text === botPassword) {
            await this.authorizeChat(chatId);
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

        if (cmd === '/report') {
          const reportId = text.replace('/report', '').trim();
          if (!reportId) {
            await this.telegram.sendMessageToChat(chatId,
              '🔎 <b>Введите ID репорта</b>\nПример: <code>/report abc123</code>');
            return { ok: true };
          }
          try {
            const report = await this.reports.getReportById(reportId);
            if (!report) {
              await this.telegram.sendMessageToChat(chatId, '❌ Репорт не найден');
              return { ok: true };
            }
            const emoji = TYPE_EMOJI[report.type] || '📌';
            const severityBar = '🔴'.repeat(Math.min(report.severity || 3, 5)) + '⚪'.repeat(5 - Math.min(report.severity || 3, 5));
            const mapLink = `https://www.google.com/maps?q=${report.lat},${report.lng}`;
            const time = report.createdAt ? new Date(report.createdAt).toLocaleString('ru-RU') : '—';

            let caption = `${emoji} <b>${report.type}</b>\n`;
            caption += `━━━━━━━━━━━━━━━\n`;
            caption += `🕐 <b>Время:</b> ${time}\n`;
            caption += `⚠️ <b>Серьёзность:</b> ${severityBar} (${report.severity}/5)\n`;
            caption += `📊 <b>Статус:</b> ${report.status}\n`;
            caption += `📍 <b>Координаты:</b> ${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}\n`;
            caption += `🗺 <a href="${mapLink}">Открыть на карте</a>\n`;
            if (report.address) caption += `📮 <b>Адрес:</b> ${report.address}\n`;
            if (report.description) caption += `📝 <b>Описание:</b> ${report.description}\n`;
            caption += `👍 <b>Подтверждений:</b> ${report.confirmedBy || 0} | 👎 <b>Отклонений:</b> ${report.rejectedBy || 0}\n`;
            caption += `━━━━━━━━━━━━━━━\n`;
            caption += `🆔 <code>${report.id}</code>`;

            const images = Array.isArray(report.images) ? report.images : [];
            if (images.length > 0) {
              await this.telegram.sendPhotoToChat(chatId, images[0], caption);
            } else {
              await this.telegram.sendMessageToChat(chatId, caption);
            }
          } catch (e) {
            await this.telegram.sendMessageToChat(chatId, `❌ Ошибка: ${e}`);
          }
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

        if (cmd === '/search') {
          const query = text.replace('/search', '').trim();
          if (!query) {
            await this.telegram.sendMessageToChat(chatId,
              '🔍 <b>Введите город</b>\nПример: <code>/search Ташкент</code>');
            return { ok: true };
          }
          try {
            const result = await this.reports.getReportsForCity(query, 1, 10);
            if (result.reports.length === 0) {
              await this.telegram.sendMessageToChat(chatId, `🔍 Репортов в <b>${query}</b> не найдено`);
              return { ok: true };
            }
            const lines = result.reports.map((r: any, i: number) => {
              const sev = r.severity >= 4 ? '🔴' : r.severity >= 3 ? '🟡' : '🟢';
              const time = r.createdAt ? new Date(r.createdAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }) : '';
              const photo = r.images && r.images.length > 0 ? '📷' : '';
              return `${i+1}. ${sev} <b>${r.type}</b> ${photo}\n   📍 ${r.address || 'нет адреса'}\n   🕐 ${time}\n   ⚠️ Серьёзность: ${r.severity}/5`;
            });
            const header = `🔍 <b>Репорты в ${query}</b> (${result.total} шт.):\n━━━━━━━━━━━━━━━`;
            const msg = [header, ...lines].join('\n\n');

            const firstWithPhoto = result.reports.find((r: any) => r.images && r.images.length > 0);
            if (firstWithPhoto && firstWithPhoto.images[0]) {
              await this.telegram.sendPhotoToChat(chatId, firstWithPhoto.images[0], msg);
            } else {
              await this.telegram.sendMessageToChat(chatId, msg);
            }
          } catch (e) {
            await this.telegram.sendMessageToChat(chatId, `❌ Ошибка поиска: ${e}`);
          }
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
