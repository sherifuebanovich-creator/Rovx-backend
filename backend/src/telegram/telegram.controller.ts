import { Controller, Post, Body, Headers, Logger, OnModuleInit } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { TelegramService } from './telegram.service';
import { AdminService } from '../admin/admin.service';
import { ReportsService } from '../reports/reports.service';
import { PremiumService } from '../premium/premium.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

/** Escapes text interpolated into a Telegram `parse_mode: 'HTML'` message body. */
function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
    private premium: PremiumService,
    private config: ConfigService,
    private redis: RedisService,
    private prisma: PrismaService,
    private ai: AiService,
  ) {}

  async onModuleInit() {
    try {
      const ids = await this.redis.smembers(AUTH_REDIS_KEY);
      for (const id of ids) {
        this.authorizedChats.add(Number(id));
      }
      this.logger.log(`Loaded ${ids.length} authorized Telegram chats from Redis`);
    } catch {}

    await this.telegram.setMyCommands([
      { command: 'start', description: 'Начать / Меню' },
      { command: 'help', description: 'Помощь / Все команды' },
      { command: 'users', description: 'Список пользователей' },
      { command: 'find', description: 'Поиск пользователя' },
      { command: 'userinfo', description: 'Инфо + пароль' },
      { command: 'setpass', description: 'Сменить пароль' },
      { command: 'reports', description: 'Репорты по городам' },
      { command: 'search', description: 'Поиск репортов' },
      { command: 'online', description: 'Кто онлайн' },
      { command: 'premium', description: 'Статистика премиума' },
      { command: 'server', description: 'Нагрузка сервера' },
      { command: 'dashboard', description: 'Полная статистика' },
      { command: 'grant', description: 'Выдать премиум' },
      { command: 'setrole', description: 'Сменить роль пользователя' },
      { command: 'logout', description: 'Выйти из бота' },
    ]);
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
      '🤖 <b>ROVX AI Assistant</b>\n\n' +
      '💬 Просто напиши сообщение — и я отвечу!\n' +
      'Я помогу с навигацией, камерами, дорогами и любыми вопросами.\n\n' +
      '━━ <b>КОМАНДЫ</b> ━━\n' +
      '📋 /reports — репорты по городам\n' +
      '🔍 /search <город> — поиск репортов\n' +
      '🟢 /online — кто сейчас онлайн\n' +
      '💎 /premium — продажи премиума\n' +
      '🖥 /server — нагрузка сервера\n' +
      '📊 /dashboard — статистика\n' +
      'ℹ️ /help — все команды\n' +
      '🚪 /logout — выйти');
  }

  @Public()
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @Post('webhook')
  async webhook(@Body() body: any, @Headers('x-telegram-bot-api-secret-token') secretToken?: string) {
    // Fail closed: without a configured secret we cannot tell a real Telegram
    // callback from a forged POST claiming an arbitrary chat.id, which would
    // let an attacker walk straight into the bot-password prompt (and from
    // there /setpass, /grant, etc.) with zero rate-limit protection.
    const expectedSecret = this.config.get('TELEGRAM_WEBHOOK_SECRET');
    if (!expectedSecret) {
      this.logger.error('TELEGRAM_WEBHOOK_SECRET is not set — rejecting webhook request');
      return { ok: false };
    }
    if (!secretToken) return { ok: false };
    const a = Buffer.from(secretToken);
    const b = Buffer.from(expectedSecret);
    if (a.length !== b.length || !require('crypto').timingSafeEqual(a, b)) {
      return { ok: false };
    }
    try {
      if (body.message?.text) {
        const text = body.message.text.trim();
        const chatId = body.message.chat.id;
        const [cmd, ...args] = text.split(' ');

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

        if (cmd === '/help' || cmd === '/commands') {
          if (!this.isAuthorized(chatId)) {
            await this.telegram.sendMessageToChat(chatId,
              '🔐 Введите пароль для доступа:');
            return { ok: true };
          }
          await this.telegram.sendMessageToChat(chatId,
            '🤖 <b>ROVX AI Assistant — Команды</b>\n\n' +
            '💬 <b>Просто напиши сообщение</b> — я отвечу!\n\n' +
            '━━ <b>ОСНОВНЫЕ</b> ━━\n' +
            '📋 /reports — репорты по городам\n' +
            '🔍 /search <город> — поиск репортов\n' +
            '🔎 /report <id> — детали репорта\n' +
            '🟢 /online — кто сейчас онлайн\n' +
            '💎 /premium — продажи премиума\n' +
            '🖥 /server — нагрузка сервера\n\n' +
            '━━ <b>УПРАВЛЕНИЕ</b> ━━\n' +
            '📊 /dashboard — полная статистика\n' +
            '👥 /users — список пользователей\n' +
            '🔍 /find <запрос> — поиск пользователя\n' +
            '👤 /userinfo <userId> — инфо + пароль\n' +
            '🔒 /setpass <userId> <пароль> — сменить пароль\n' +
            '💰 /payments — ожидающие оплаты\n\n' +
            '━━ <b>ПРЕМИУМ</b> ━━\n' +
            '💎 /grant <id> <уровень> [дней] — выдать премиум\n' +
            '   Уровни: PREMIUM_BASIC, PREMIUM_STANDARD, PREMIUM_MAX\n' +
            '   Пример: <code>/grant userId PREMIUM_MAX 30</code>\n\n' +
            '━━ <b>АДМИН</b> ━━\n' +
            '🚫 /ban <id> [причина] — забанить\n' +
            '✅ /unban <id> — разбанить\n' +
            '🔑 /role <id> <роль> — сменить роль\n' +
            '   Доступные роли: USER, MODERATOR, ADMIN, SUPERADMIN\n' +
            '🏠 /groups — список групп\n' +
            '📋 /group <id> — инфо о группе\n' +
            '🚫 /deactivate <id> — деактивировать подписку\n' +
            '🚪 /logout — выйти');
          return { ok: true };
        }

        if (!this.isAuthorized(chatId)) {
          const botPassword = this.config.get('TELEGRAM_BOT_PASSWORD');
          if (!botPassword) {
            await this.telegram.sendMessageToChat(chatId, '❌ Bot not configured');
            return { ok: true };
          }

          const attemptsKey = `telegram:auth_attempts:${chatId}`;
          const attempts = await this.redis.incr(attemptsKey);
          if (attempts === 1) {
            await this.redis.expire(attemptsKey, 15 * 60);
          }
          if (attempts > 5) {
            await this.telegram.sendMessageToChat(chatId, '⏳ Слишком много попыток. Попробуйте позже.');
            return { ok: true };
          }

          const a = Buffer.from(text);
          const b = Buffer.from(botPassword);
          if (a.length === b.length && require('crypto').timingSafeEqual(a, b)) {
            await this.redis.del(attemptsKey);
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
            if (report.address) caption += `📮 <b>Адрес:</b> ${escapeTelegramHtml(report.address)}\n`;
            if (report.description) caption += `📝 <b>Описание:</b> ${escapeTelegramHtml(report.description)}\n`;
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

        if (cmd === '/payments') {
          await this.sendPendingPayments(chatId);
          return { ok: true };
        }

        if (cmd === '/stats') {
          await this.sendAdminStats(chatId);
          return { ok: true };
        }

        if (cmd === '/dashboard') {
          await this.sendDashboard(chatId);
          return { ok: true };
        }

        if (cmd === '/users') {
          await this.sendUsersList(chatId);
          return { ok: true };
        }

        if (cmd === '/find') {
          const query = text.replace('/find', '').trim();
          if (!query) {
            await this.telegram.sendMessageToChat(chatId,
              '🔍 <b>Введите имя, email или username</b>\nПример: <code>/find Иван</code>');
            return { ok: true };
          }
          await this.sendFindUser(chatId, query);
          return { ok: true };
        }

        if (cmd === '/userinfo') {
          const userId = text.replace('/userinfo', '').trim();
          if (!userId) {
            await this.telegram.sendMessageToChat(chatId,
              '👤 <b>Введите user ID</b>\nПример: <code>/userinfo abc123</code>');
            return { ok: true };
          }
          await this.sendUserInfo(chatId, userId);
          return { ok: true };
        }

        if (cmd === '/grant' || cmd === '/give') {
          const parts = args;
          if (parts.length < 2) {
            await this.telegram.sendMessageToChat(chatId,
              '💎 <b>Выдать премиум</b>\n\n' +
              'Пример: <code>/grant userId PREMIUM_MAX 30</code>\n\n' +
              'Доступные уровни:\n' +
              '• PREMIUM_BASIC\n' +
              '• PREMIUM_STANDARD\n' +
              '• PREMIUM_MAX\n\n' +
              'По умолчанию: 30 дней');
            return { ok: true };
          }
          await this.sendGrant(chatId, parts[0], parts[1], parseInt(parts[2]) || 30);
          return { ok: true };
        }

        if (cmd === '/ban') {
          const parts = args;
          if (parts.length < 1) {
            await this.telegram.sendMessageToChat(chatId,
              '🚫 <b>Забанить пользователя</b>\n\n' +
              'Пример: <code>/ban userId спам</code>');
            return { ok: true };
          }
          const reason = parts.slice(1).join(' ') || 'Без причины';
          await this.sendBan(chatId, parts[0], reason);
          return { ok: true };
        }

        if (cmd === '/unban') {
          const userId = text.replace('/unban', '').trim();
          if (!userId) {
            await this.telegram.sendMessageToChat(chatId,
              '✅ <b>Разбанить пользователя</b>\n\nПример: <code>/unban userId</code>');
            return { ok: true };
          }
          await this.sendUnban(chatId, userId);
          return { ok: true };
        }

        if (cmd === '/role' || cmd === '/setrole') {
          const parts = args;
          if (parts.length < 2) {
            await this.telegram.sendMessageToChat(chatId,
              '🔑 <b>Сменить роль</b>\n\n' +
              'Пример: <code>/role userId ADMIN</code>\n\n' +
              'Доступные роли:\n' +
              '• USER\n' +
              '• ADMIN\n' +
              '• SUPERADMIN');
            return { ok: true };
          }
          await this.sendRole(chatId, parts[0], parts[1]);
          return { ok: true };
        }

        if (cmd === '/groups') {
          await this.sendGroupsList(chatId);
          return { ok: true };
        }

        if (cmd === '/group') {
          const groupId = text.replace('/group', '').trim();
          if (!groupId) {
            await this.telegram.sendMessageToChat(chatId,
              '📋 <b>Инфо о группе</b>\n\nПример: <code>/group groupId</code>');
            return { ok: true };
          }
          await this.sendGroupInfo(chatId, groupId);
          return { ok: true };
        }

        if (cmd === '/approve') {
          const userId = text.replace('/approve', '').trim();
          if (!userId) {
            await this.telegram.sendMessageToChat(chatId, '❌ Укажи user ID');
            return { ok: true };
          }
          const result = await this.premium.approvePayment(userId);
          await this.telegram.sendMessageToChat(chatId, result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
          return { ok: true };
        }

        if (cmd === '/reject') {
          const userId = text.replace('/reject', '').trim();
          if (!userId) {
            await this.telegram.sendMessageToChat(chatId, '❌ Укажи user ID');
            return { ok: true };
          }
          const result = await this.premium.rejectPayment(userId);
          await this.telegram.sendMessageToChat(chatId, result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
          return { ok: true };
        }

        if (cmd === '/deactivate') {
          const userId = text.replace('/deactivate', '').trim();
          if (!userId) {
            await this.telegram.sendMessageToChat(chatId, '❌ Укажи user ID');
            return { ok: true };
          }
          await this.premium.deactivateUser(userId);
          await this.telegram.sendMessageToChat(chatId, `✅ Подписка деактивирована для ${userId}`);
          return { ok: true };
        }

        if (cmd === '/setpass') {
          const parts = args;
          if (parts.length < 2) {
            await this.telegram.sendMessageToChat(chatId,
              '🔒 <b>Сменить пароль</b>\n\n' +
              'Пример: <code>/setpass userId новый_пароль</code>');
            return { ok: true };
          }
          const bcrypt = require('bcrypt');
          const hash = await bcrypt.hash(parts[1], 10);
          // Revoke the user's existing sessions so a compromised account can't
          // keep using old tokens after the password is reset.
          await this.prisma.user.update({
            where: { id: parts[0] },
            data: { passwordHash: hash, refreshToken: null },
          });
          await this.telegram.sendMessageToChat(chatId,
            `✅ Пароль изменён для <code>${parts[0]}</code>\nСтарые сессии отозваны.`);
          return { ok: true };
        }

        if (cmd === '/reply') {
          const parts = args;
          if (parts.length < 2) {
            await this.telegram.sendMessageToChat(chatId,
              '↩️ <b>Ответить пользователю</b>\n\n' +
              'Пример: <code>/reply chatId Привет! Чем могу помочь?</code>\n\n' +
              'Чтобы узнать chatId пользователя, посмотрите сообщение выше (пересланное от пользователя).');
            return { ok: true };
          }
          const targetChatId = parseInt(parts[0]);
          const replyText = parts.slice(1).join(' ');
          if (isNaN(targetChatId)) {
            await this.telegram.sendMessageToChat(chatId, '❌ Неверный chatId. Должно быть число.');
            return { ok: true };
          }
          await this.telegram.sendMessageToChat(targetChatId,
            `💬 <b>Ответ от поддержки ROVX:</b>\n\n${replyText}`);
          await this.telegram.sendMessageToChat(chatId, `✅ Ответ отправлен пользователю ${targetChatId}`);
          return { ok: true };
        }

        // Forward non-command messages to AI assistant
        if (!cmd.startsWith('/')) {
          try {
            await this.telegram.sendMessageToChat(chatId, '🤖 Думаю...');
            const reply = await this.ai.chat(chatId, text);
            await this.telegram.sendMessageToChat(chatId, reply);
          } catch (error) {
            await this.telegram.sendMessageToChat(chatId, '❌ Ошибка AI. Попробуйте позже.');
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

        if (data?.startsWith('pay_approve_')) {
          const userId = data.replace('pay_approve_', '');
          const result = await this.premium.approvePayment(userId);
          if (result.success) {
            await this.telegram.answerCallbackQuery(cbId, '✅ Платёж одобрен!');
            if (chatId) {
              await this.telegram.sendMessageToChat(chatId, `✅ Платёж одобрен!\nПользователь ${userId.slice(0, 8)}... получил премиум.`);
            }
          } else {
            await this.telegram.answerCallbackQuery(cbId, `❌ ${result.message}`);
          }
          return { ok: true };
        }

        if (data?.startsWith('pay_reject_')) {
          const userId = data.replace('pay_reject_', '');
          const result = await this.premium.rejectPayment(userId);
          if (result.success) {
            await this.telegram.answerCallbackQuery(cbId, '❌ Платёж отклонён');
            if (chatId) {
              await this.telegram.sendMessageToChat(chatId, `❌ Платёж отклонён.\nПользователь ${userId.slice(0, 8)}... — подписка сброшена.`);
            }
          } else {
            await this.telegram.answerCallbackQuery(cbId, `❌ ${result.message}`);
          }
          return { ok: true };
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

  // ─── USER MANAGEMENT ─────────────────────────────────────────────────────

  private async sendUserInfo(chatId: number, userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          _count: {
            select: { trips: true, reports: true, followers: true, following: true },
          },
        },
      });
      if (!user) {
        await this.telegram.sendMessageToChat(chatId, `❌ Пользователь не найден`);
        return;
      }
      const subEnd = user.subscriptionEnd
        ? new Date(user.subscriptionEnd).toLocaleDateString('ru-RU')
        : '—';
      const banStatus = user.isBanned ? `🚫 <b>ЗАБАНЕН</b>\n   📝 Причина: ${user.bannedReason || '—'}` : '✅ Активен';
      const hasPassword = !!user.passwordHash;
      const regMethod = user.googleId ? '🌐 Google OAuth' : hasPassword ? '📧 Email + Пароль' : '❓ Неизвестно';

      const msg = `👤 <b>ПОЛЬЗОВАТЕЛЬ</b>\n━━━━━━━━━━━━━━━\n` +
        `🆔 <code>${user.id}</code>\n` +
        `📛 <b>${user.displayName || '—'}</b>\n\n` +
        `━━ <b>АККАУНТ</b> ━━\n` +
        `🌐 Регистрация: ${regMethod}\n` +
        `📧 Google / Email: <code>${user.email || '—'}</code>\n` +
        `🏷 @${user.username || '—'}\n` +
        (user.googleId ? `🔑 Google ID: <code>${user.googleId}</code>\n` : '') +
        (hasPassword ? `🔒 Пароль: установлен (используйте /setpass для сброса)\n` : `🔒 Пароль: не задан (Google вход)\n`) +
        `🔑 Роль: <b>${user.role}</b>\n\n` +
        `━━ <b>СТАТИСТИКА</b> ━━\n` +
        `💎 Подписка: <b>${user.subscription}</b>\n` +
        `📅 Действует до: ${subEnd}\n` +
        `🔄 Репутация: ${user.reputation || 0}\n` +
        `🚗 Поездок: ${user._count?.trips || 0}\n` +
        `📋 Репортов: ${user._count?.reports || 0}\n` +
        `👥 Подписчиков: ${user._count?.followers || 0}\n` +
        `📅 Регистрация: ${new Date(user.createdAt).toLocaleDateString('ru-RU')}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `${banStatus}`;

      await this.telegram.sendMessageToChat(chatId, msg);
    } catch (error) {
      await this.telegram.sendMessageToChat(chatId, `❌ Пользователь не найден`);
    }
  }

  private async sendGrant(chatId: number, userId: string, tier: string, days: number) {
    try {
      const result = await this.admin.grantPremium(userId, tier, days);
      if (result.success) {
        const endDate = new Date(result.endDate).toLocaleDateString('ru-RU');
        await this.telegram.sendMessageToChat(chatId,
          `✅ <b>Премиум выдан!</b>\n\n` +
          `👤 Пользователь: <code>${userId}</code>\n` +
          `💎 Тариф: <b>${result.subscription}</b>\n` +
          `📅 Действует до: ${endDate}\n` +
          `📆 Дней: ${days}`);
      } else {
        await this.telegram.sendMessageToChat(chatId, `❌ Не удалось выдать премиум`);
      }
    } catch (error) {
      await this.telegram.sendMessageToChat(chatId, `❌ Ошибка: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async sendBan(chatId: number, userId: string, reason: string) {
    try {
      // The Telegram operator channel is itself an authenticated super-admin
      // surface (bot-password gated); pass SUPERADMIN explicitly so
      // assertCanActOn's hierarchy check (which otherwise treats a missing
      // actorRole as level 0 and rejects every target) doesn't always throw.
      await this.admin.banUser(userId, reason, undefined, 'SUPERADMIN');
      await this.telegram.sendMessageToChat(chatId,
        `🚫 <b>Пользователь забанен</b>\n\n` +
        `🆔 <code>${userId}</code>\n` +
        `📝 Причина: ${reason}`);
    } catch (error) {
      await this.telegram.sendMessageToChat(chatId, `❌ Ошибка: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async sendUnban(chatId: number, userId: string) {
    try {
      await this.admin.unbanUser(userId, undefined, 'SUPERADMIN');
      await this.telegram.sendMessageToChat(chatId,
        `✅ <b>Пользователь разбанен</b>\n\n` +
        `🆔 <code>${userId}</code>`);
    } catch (error) {
      await this.telegram.sendMessageToChat(chatId, `❌ Ошибка: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async sendRole(chatId: number, userId: string, role: string) {
    try {
      const validRoles = ['USER', 'ADMIN', 'SUPERADMIN'];
      if (!validRoles.includes(role.toUpperCase())) {
        await this.telegram.sendMessageToChat(chatId,
          `❌ Неверная роль. Доступные: ${validRoles.join(', ')}`);
        return;
      }
      await this.admin.updateUserRole(userId, role.toUpperCase(), undefined, 'SUPERADMIN');
      await this.telegram.sendMessageToChat(chatId,
        `🔑 <b>Роль изменена</b>\n\n` +
        `🆔 <code>${userId}</code>\n` +
        `🏷 Новая роль: <b>${role.toUpperCase()}</b>`);
    } catch (error) {
      await this.telegram.sendMessageToChat(chatId, `❌ Ошибка: ${error instanceof Error ? error.message : error}`);
    }
  }

  // ─── GROUPS ──────────────────────────────────────────────────────────────

  private async sendGroupsList(chatId: number) {
    try {
      const groups = await this.prisma.group.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { _count: { select: { members: true, messages: true } } },
      });

      if (groups.length === 0) {
        await this.telegram.sendMessageToChat(chatId, '🏠 Нет групп');
        return;
      }

      let msg = `🏠 <b>ГРУППЫ (${groups.length})</b>\n━━━━━━━━━━━━━━━\n\n`;
      for (const g of groups) {
        const type = g.isPublic ? '🌐' : '🔒';
        const photo = g.avatar ? '📷' : '';
        msg += `${type} <b>${g.name}</b> ${photo}\n`;
        msg += `   👥 ${g._count.members} | 💬 ${g._count.messages}\n`;
        msg += `   📅 ${new Date(g.createdAt).toLocaleDateString('ru-RU')}\n`;
        msg += `   🆔 <code>${g.id}</code>\n\n`;
      }
      await this.telegram.sendMessageToChat(chatId, msg);
    } catch (error) {
      await this.telegram.sendMessageToChat(chatId, `❌ Ошибка: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async sendGroupInfo(chatId: number, groupId: string) {
    try {
      const group = await this.prisma.group.findUnique({
        where: { id: groupId },
        include: {
          owner: { select: { id: true, displayName: true, username: true } },
          _count: { select: { members: true, messages: true } },
        },
      });

      if (!group) {
        await this.telegram.sendMessageToChat(chatId, '❌ Группа не найдена');
        return;
      }

      const members = await this.prisma.groupMember.findMany({
        where: { groupId },
        include: { user: { select: { id: true, displayName: true, username: true, role: true } } },
        take: 20,
      });

      const type = group.isPublic ? '🌐 Публичная' : '🔒 Приватная';
      const photoStatus = group.avatar ? `📷 <a href="${group.avatar}">Фото</a>` : '📷 Нет фото';

      let msg = `📋 <b>ГРУППА</b>\n━━━━━━━━━━━━━━━\n` +
        `📛 <b>${group.name}</b>\n` +
        `📝 ${group.description || 'Без описания'}\n` +
        `📊 Тип: ${type}\n` +
        `🖼 Фото: ${photoStatus}\n` +
        `👥 Участников: ${group._count.members}\n` +
        `💬 Сообщений: ${group._count.messages}\n` +
        `👑 Владелец: ${group.owner?.displayName || '—'}\n` +
        `📅 Создана: ${new Date(group.createdAt).toLocaleDateString('ru-RU')}\n` +
        `🆔 <code>${group.id}</code>\n` +
        `━━━━━━━━━━━━━━━\n\n`;

      if (members.length > 0) {
        msg += `👥 <b>Участники:</b>\n`;
        for (const m of members) {
          const role = m.isAdmin ? '⭐' : '•';
          msg += `${role} ${m.user.displayName || m.user.username || '—'}\n`;
        }
      }

      await this.telegram.sendMessageToChat(chatId, msg);
    } catch (error) {
      await this.telegram.sendMessageToChat(chatId, `❌ Ошибка: ${error instanceof Error ? error.message : error}`);
    }
  }

  // ─── DASHBOARD ───────────────────────────────────────────────────────────

  private async sendDashboard(chatId: number) {
    try {
      const stats = await this.admin.getDashboardStats();

      const msg = `📊 <b>DASHBOARD ROVX</b>\n━━━━━━━━━━━━━━━\n\n` +
        `👥 <b>Пользователи</b>\n` +
        `   Всего: ${stats.users.total}\n` +
        `   Сегодня: +${stats.users.newToday}\n` +
        `   За неделю: +${stats.users.newThisWeek}\n` +
        `   Онлайн: ${stats.users.online}\n\n` +
        `🚗 <b>Поездки</b>\n` +
        `   Всего: ${stats.trips.total}\n` +
        `   Сегодня: ${stats.trips.today}\n\n` +
        `📋 <b>Репорты</b>\n` +
        `   Активных: ${stats.reports.active}\n` +
        `   Всего: ${stats.reports.total}\n\n` +
        `🗺 <b>Объектов на карте:</b> ${stats.mapObjects.total}\n` +
        `💎 <b>Премиум пользователей:</b> ${stats.revenue.premiumUsers}\n`;

      await this.telegram.sendMessageToChat(chatId, msg);
    } catch (error) {
      await this.telegram.sendMessageToChat(chatId, `❌ Ошибка: ${error instanceof Error ? error.message : error}`);
    }
  }

  // ─── REPORTS / PREMIUM / SERVER ──────────────────────────────────────────

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

  private async sendPendingPayments(chatId: number) {
    try {
      const payments = await this.premium.getPendingPayments();
      if (!payments.length) {
        await this.telegram.sendMessageToChat(chatId, '✅ Нет ожидающих платежей');
        return;
      }
      let msg = `💰 <b>ОЖИДАЮЩИЕ ОПЛАТЫ (${payments.length})</b>\n━━━━━━━━━━━━━━━\n\n`;
      for (const p of payments) {
        const name = p.user?.displayName || p.user?.email || '—';
        const time = p.createdAt ? new Date(p.createdAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }) : '';
        msg += `👤 <b>${name}</b>\n`;
        msg += `💎 ${p.levelName} — $${p.price}\n`;
        msg += `🔢 Последние 4: ${p.paymentId?.slice(-4) || '?'}\n`;
        msg += `🕐 ${time}\n`;
        msg += `🆔 <code>${p.userId}</code>\n\n`;
      }
      msg += `Для одобрения: <code>/approve userId</code>\nДля отклонения: <code>/reject userId</code>`;
      await this.telegram.sendMessageToChat(chatId, msg);
    } catch (error) {
      this.logger.error('Failed to send pending payments', error instanceof Error ? error.message : String(error));
      await this.telegram.sendMessageToChat(chatId, '❌ Ошибка при получении платежей');
    }
  }

  private async sendAdminStats(chatId: number) {
    try {
      const stats = await this.premium.getAdminStats();
      const msg = `📊 <b>СТАТИСТИКА ROVX</b>\n━━━━━━━━━━━━━━━\n\n` +
        `👥 Всего пользователей: <b>${stats.totalUsers}</b>\n` +
        `💎 Активных подписок: <b>${stats.activeSubs}</b>\n` +
        `⏳ Ожидают оплаты: <b>${stats.pendingPayments}</b>\n\n` +
        `📅 <b>Платежи:</b>\n` +
        `  Сегодня: ${stats.todayPayments}\n` +
        `  За неделю: ${stats.weekPayments}\n` +
        `  За месяц: ${stats.monthPayments}\n\n` +
        `💰 Общий доход: <b>$${stats.totalRevenue}</b>`;
      await this.telegram.sendMessageToChat(chatId, msg);
    } catch (error) {
      this.logger.error('Failed to send admin stats', error instanceof Error ? error.message : String(error));
      await this.telegram.sendMessageToChat(chatId, '❌ Ошибка при получении статистики');
    }
  }

  private async sendUsersList(chatId: number) {
    try {
      const { users, total } = await this.premium.getAllUsers(1, 10);
      let msg = `👥 <b>ПОЛЬЗОВАТЕЛИ (показано ${users.length} из ${total})</b>\n━━━━━━━━━━━━━━━\n\n`;
      for (const u of users) {
        const name = u.displayName || u.username || u.email || '—';
        const sub = u.subscription === 'FREE' ? '🆓' : '💎';
        const subEnd = u.subscriptionEnd ? `до ${new Date(u.subscriptionEnd).toLocaleDateString('ru-RU')}` : '';
        msg += `${sub} <b>${name}</b>\n   📧 ${u.email || '—'}\n   🏷 @${u.username || '—'}\n   💎 ${u.subscription} ${subEnd}\n   📅 ${new Date(u.createdAt).toLocaleDateString('ru-RU')}\n   🆔 <code>${u.id}</code>\n\n`;
      }
      msg += `Для поиска: <code>/find имя</code>\nДля пароля: <code>/userinfo userId</code>`;
      await this.telegram.sendMessageToChat(chatId, msg);
    } catch (error) {
      this.logger.error('Failed to send users', error instanceof Error ? error.message : String(error));
      await this.telegram.sendMessageToChat(chatId, '❌ Ошибка при получении пользователей');
    }
  }

  private async sendFindUser(chatId: number, query: string) {
    try {
      const user = await this.premium.findUser(query);
      if (!user) {
        await this.telegram.sendMessageToChat(chatId, `🔍 Пользователь «${query}» не найден`);
        return;
      }
      const name = user.displayName || user.username || '—';
      const subEnd = user.subscriptionEnd ? new Date(user.subscriptionEnd).toLocaleDateString('ru-RU') : '—';
      const msg = `👤 <b>${name}</b>\n━━━━━━━━━━━━━━━\n` +
        `📧 ${user.email || '—'}\n` +
        `🏷 Username: ${user.username || '—'}\n` +
        `💎 Подписка: ${user.subscription}\n` +
        `📅 Действует до: ${subEnd}\n` +
        `📝 Репортов: ${user._count?.reports || 0}\n` +
        `📅 Регистрация: ${new Date(user.createdAt).toLocaleDateString('ru-RU')}\n` +
        `🆔 <code>${user.id}</code>\n\n` +
        `Для подробностей: <code>/userinfo ${user.id}</code>`;
      await this.telegram.sendMessageToChat(chatId, msg);
    } catch (error) {
      this.logger.error('Failed to find user', error instanceof Error ? error.message : String(error));
      await this.telegram.sendMessageToChat(chatId, '❌ Ошибка поиска');
    }
  }
}
