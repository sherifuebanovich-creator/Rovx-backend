import { Injectable, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TelegramService } from '../telegram/telegram.service';
import { PREMIUM_TIERS } from '../premium/premium.service';
import { escapeTelegramHtml } from '../common/utils/telegram.util';

@Injectable()
export class SupportService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private telegram: TelegramService,
  ) {}

  async submit(userId: string, message: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, displayName: true, email: true, subscription: true, subscriptionEnd: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // `subscription` alone isn't enough — it's only ever reset to FREE on
    // explicit cancel/admin action, not automatically on expiry (same gap
    // already fixed in friends.controller.ts's getLocations and
    // roadpilot.gateway.ts's location broadcast) — without this, a lapsed
    // premium user keeps their higher daily support-message limit forever.
    const expired = !!user.subscriptionEnd && user.subscriptionEnd < new Date();
    const tier = (!expired && PREMIUM_TIERS.find((t) => t.name === user.subscription)) || PREMIUM_TIERS[0];
    const limit = tier.supportLimit;

    // Fixed calendar-day window (not a rolling 24h one) so the limit reads
    // as "N messages per day" the way it's described to users, and resets
    // predictably at midnight rather than 24h after their first message.
    const today = new Date().toISOString().slice(0, 10);
    const key = `support:count:${userId}:${today}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, 26 * 60 * 60);
    }
    if (count > limit) {
      throw new ForbiddenException(
        `Daily support message limit reached (${limit} per day on your plan). Try again tomorrow or upgrade for a higher limit.`,
      );
    }

    // sendMessage swallows Telegram/network errors internally and used to
    // return void, so a failed delivery still reported { success: true } to
    // the user — the message was silently lost with no record anywhere
    // (there's no SupportMessage table, Telegram is the only channel).
    // Surface the real outcome so the user knows to retry instead of
    // believing support received something it never got.
    const delivered = await this.telegram.sendMessage(
      '🆘 <b>Обращение в поддержку</b>\n' +
        `От: ${escapeTelegramHtml(user.displayName || user.username)} (@${escapeTelegramHtml(user.username)})\n` +
        `Email: ${escapeTelegramHtml(user.email)}\n` +
        `Тариф: ${user.subscription}\n` +
        `ID: <code>${userId}</code>\n\n` +
        escapeTelegramHtml(message) +
        `\n\n↩️ Ответить: <code>/answer ${userId} ваш текст</code>`,
    );
    if (!delivered) {
      throw new ServiceUnavailableException('Failed to deliver your message to support. Please try again.');
    }

    return { success: true, remaining: Math.max(0, limit - count) };
  }
}
