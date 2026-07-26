import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken: string;
  private readonly chatId: string;

  constructor(private config: ConfigService) {
    this.botToken = this.config.get('TELEGRAM_BOT_TOKEN', '');
    this.chatId = this.config.get('TELEGRAM_CHAT_ID', '');
  }

  get isConfigured() {
    return !!this.botToken && !!this.chatId;
  }

  async sendMessage(text: string, parseMode: 'HTML' | 'Markdown' = 'HTML') {
    if (!this.isConfigured) return;
    try {
      await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        chat_id: this.chatId,
        text,
        parse_mode: parseMode,
      }, { timeout: 10000 });
    } catch (error) {
      this.logger.error('Failed to send Telegram message', error instanceof Error ? error.message : String(error));
    }
  }

  async sendReportNotification(report: {
    type: string;
    description?: string;
    lat: number;
    lng: number;
    severity: number;
    images?: string[];
    address?: string;
    city?: string;
    time?: string;
    userDisplayName?: string;
  }) {
    if (!this.isConfigured) {
      this.logger.warn('Telegram not configured, skipping notification');
      return;
    }

    const severityEmoji = report.severity >= 4 ? '🔴' : report.severity >= 3 ? '🟡' : '🟢';
    const mapLink = `https://www.google.com/maps?q=${report.lat},${report.lng}`;
    const coordsText = `${report.lat.toFixed(6)}, ${report.lng.toFixed(6)}`;

    let text = `${severityEmoji} <b>НОВЫЙ РЕПОРТ</b>\n`;
    text += `━━━━━━━━━━━━━━━\n`;
    text += `<b>🕐 Время:</b> ${report.time || 'не указано'}\n`;
    text += `<b>🏙 Город:</b> ${report.city || 'не определён'}\n`;
    text += `<b>📌 Тип:</b> ${report.type}\n`;
    text += `<b>⚠️ Серьёзность:</b> ${report.severity}/5\n`;
    if (report.address) text += `<b>📍 Адрес:</b> ${report.address}\n`;
    text += `<b>🌐 Координаты:</b> ${coordsText}\n`;
    text += `<b>🗺 Карта:</b> ${mapLink}\n`;
    if (report.description) text += `<b>📝 Описание:</b> ${report.description}\n`;
    text += `━━━━━━━━━━━━━━━\n`;
    if (report.userDisplayName) text += `<b>👤 От:</b> ${report.userDisplayName}\n`;

    try {
      if (report.images && report.images.length > 0) {
        await axios.post(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, {
          chat_id: this.chatId,
          photo: report.images[0],
          caption: text,
          parse_mode: 'HTML',
        }, { timeout: 10000 });
      } else {
        await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
          chat_id: this.chatId,
          text,
          parse_mode: 'HTML',
        }, { timeout: 10000 });
      }
      this.logger.log(`Report sent to Telegram: ${report.type}`);
    } catch (error) {
      this.logger.error('Failed to send Telegram notification', error instanceof Error ? error.message : String(error));
    }
  }

  async sendStatsMessage(statsText: string) {
    if (!this.isConfigured) return;

    try {
      await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        chat_id: this.chatId,
        text: statsText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }, { timeout: 15000 });
    } catch (error) {
      this.logger.error('Failed to send stats', error instanceof Error ? error.message : String(error));
    }
  }

  async sendStatsWithButtons(statsText: string, buttons: Array<{ text: string; callback_data: string }>) {
    if (!this.isConfigured) return;

    try {
      await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        chat_id: this.chatId,
        text: statsText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: buttons.map(b => [b]),
        },
      }, { timeout: 15000 });
    } catch (error) {
      this.logger.error('Failed to send stats with buttons', error instanceof Error ? error.message : String(error));
    }
  }

  async answerCallbackQuery(callbackQueryId: string, text: string, showAlert = true) {
    if (!this.isConfigured) return;
    try {
      await axios.post(`https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`, {
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      }, { timeout: 10000 });
    } catch (error) {
      this.logger.error('Failed to answer callback', error instanceof Error ? error.message : String(error));
    }
  }

  // Accepts either a flat list (one button per row, existing behavior) or
  // pre-grouped rows (e.g. a single row with both a "prev" and "next"
  // button side by side, for book-style pagination) — a plain button object
  // becomes its own row, an array is used as a row as-is.
  async sendMessageToChat(chatId: number, text: string, buttons?: Array<{ text: string; callback_data: string } | Array<{ text: string; callback_data: string }>>) {
    if (!this.botToken) return;
    try {
      const payload: any = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      };
      if (buttons && buttons.length > 0) {
        payload.reply_markup = { inline_keyboard: buttons.map(b => Array.isArray(b) ? b : [b]) };
      }
      const res = await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, payload, { timeout: 15000 });
      return res.data?.result?.message_id as number | undefined;
    } catch (error) {
      this.logger.error('Failed to send message to chat', error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  async editMessageText(chatId: number, messageId: number, text: string, buttons?: Array<{ text: string; callback_data: string } | Array<{ text: string; callback_data: string }>>) {
    if (!this.botToken) return;
    try {
      const payload: any = {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      };
      if (buttons && buttons.length > 0) {
        payload.reply_markup = { inline_keyboard: buttons.map(b => Array.isArray(b) ? b : [b]) };
      }
      await axios.post(`https://api.telegram.org/bot${this.botToken}/editMessageText`, payload, { timeout: 15000 });
    } catch (error) {
      this.logger.error('Failed to edit message', error instanceof Error ? error.message : String(error));
    }
  }

  async sendPhotoToChat(chatId: number, photoUrl: string, caption: string, buttons?: Array<{ text: string; callback_data: string }>) {
    if (!this.botToken) return;
    try {
      const payload: any = {
        chat_id: chatId,
        photo: photoUrl,
        caption,
        parse_mode: 'HTML',
      };
      if (buttons && buttons.length > 0) {
        payload.reply_markup = { inline_keyboard: buttons.map(b => [b]) };
      }
      await axios.post(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, payload, { timeout: 15000 });
    } catch (error) {
      this.logger.error('Failed to send photo to chat', error instanceof Error ? error.message : String(error));
    }
  }

  async setMyCommands(commands: Array<{ command: string; description: string }>) {
    if (!this.botToken) return;
    try {
      await axios.post(`https://api.telegram.org/bot${this.botToken}/setMyCommands`, {
        commands,
      }, { timeout: 10000 });
      this.logger.log(`Set ${commands.length} bot commands`);
    } catch (error) {
      this.logger.error('Failed to set bot commands', error instanceof Error ? error.message : String(error));
    }
  }

  async forwardMessage(chatId: number, fromChatId: number, fromMessageId: number) {
    if (!this.botToken) return;
    try {
      await axios.post(`https://api.telegram.org/bot${this.botToken}/forwardMessage`, {
        chat_id: chatId,
        from_chat_id: fromChatId,
        message_id: fromMessageId,
      }, { timeout: 10000 });
    } catch (error) {
      this.logger.error('Failed to forward message', error instanceof Error ? error.message : String(error));
    }
  }
}
