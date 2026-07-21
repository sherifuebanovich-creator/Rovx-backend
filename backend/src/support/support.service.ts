import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TelegramService } from '../telegram/telegram.service';
import { PREMIUM_TIERS } from '../premium/premium.service';

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
      select: { username: true, displayName: true, email: true, subscription: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const tier = PREMIUM_TIERS.find((t) => t.name === user.subscription) || PREMIUM_TIERS[0];
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

    await this.telegram.sendMessage(
      '🆘 <b>Обращение в поддержку</b>\n' +
        `От: ${escapeTelegramHtml(user.displayName || user.username)} (@${escapeTelegramHtml(user.username)})\n` +
        `Email: ${escapeTelegramHtml(user.email)}\n` +
        `Тариф: ${user.subscription}\n\n` +
        escapeTelegramHtml(message),
    );

    return { success: true, remaining: Math.max(0, limit - count) };
  }
}
