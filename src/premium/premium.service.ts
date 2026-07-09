import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { XsollaService } from './xsolla.service';

export const PREMIUM_TIERS = [
  { tier: 0, name: 'FREE', price: 0, maxGroups: 0, canCreateGroups: false, canReceiveReports: false, label_en: 'Free', label_ru: 'Бесплатно' },
  { tier: 1, name: 'PREMIUM_BASIC', price: 5, maxGroups: 1, canCreateGroups: false, canReceiveReports: true, label_en: 'Premium Basic', label_ru: 'Premium Basic' },
  { tier: 2, name: 'PREMIUM_STANDARD', price: 10, maxGroups: 3, canCreateGroups: false, canReceiveReports: true, label_en: 'Premium Standard', label_ru: 'Premium Standard' },
  { tier: 3, name: 'PREMIUM_MAX', price: 20, maxGroups: 10, canCreateGroups: true, canReceiveReports: true, label_en: 'Premium Max', label_ru: 'Premium Max' },
] as const;

export type PremiumTier = typeof PREMIUM_TIERS[number];

@Injectable()
export class PremiumService {
  private readonly logger = new Logger(PremiumService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private xsolla: XsollaService,
  ) {}

  getTiers(lang = 'en') {
    return PREMIUM_TIERS.map(t => ({
      ...t,
      label: lang === 'ru' ? t.label_ru : t.label_en,
    }));
  }

  getTierInfo(subscription: string): PremiumTier {
    const found = PREMIUM_TIERS.find(t => t.name === subscription);
    if (!found) {
      this.logger.warn(`Unknown subscription tier "${subscription}", falling back to FREE`);
      return PREMIUM_TIERS[0];
    }
    return found;
  }

  async getUserTier(userId: string): Promise<PremiumTier> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { subscription: true, subscriptionEnd: true },
    });
    if (!user) return PREMIUM_TIERS[0];
    if (user.subscriptionEnd && user.subscriptionEnd < new Date()) {
      return PREMIUM_TIERS[0];
    }
    return this.getTierInfo(user.subscription);
  }

  async canCreateGroup(userId: string): Promise<{ allowed: boolean; currentGroups: number; maxGroups: number; tier: number; tierRequired: string }> {
    const tier = await this.getUserTier(userId);
    const maxTier = PREMIUM_TIERS[PREMIUM_TIERS.length - 1];
    if (!tier.canCreateGroups) {
      return { allowed: false, currentGroups: 0, maxGroups: 1, tier: tier.tier, tierRequired: maxTier.label_en };
    }
    const groupCount = await this.prisma.group.count({ where: { ownerId: userId } });
    const allowed = groupCount < tier.maxGroups;
    return { allowed, currentGroups: groupCount, maxGroups: tier.maxGroups, tier: tier.tier, tierRequired: maxTier.label_en };
  }

  async createCheckoutSession(userId: string, tierName: string, months: number = 1): Promise<{ url: string; paymentId: string }> {
    const tier = PREMIUM_TIERS.find(t => t.name === tierName);
    if (!tier || tier.tier === 0) {
      throw new BadRequestException('Invalid tier');
    }

    if (!this.xsolla.configured) {
      throw new BadRequestException('Xsolla payment is not configured');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const amount = +(tier.price * months).toFixed(2);

    try {
      const { token, url } = await this.xsolla.createPaymentToken({
        userId,
        email: user.email,
        userName: user.displayName || user.username || user.email,
        tierName,
        tierPrice: tier.price,
        months,
      });

      await this.prisma.premiumSubscription.upsert({
        where: { userId },
        create: {
          userId,
          tier: tier.tier,
          levelName: tier.name,
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          price: amount,
          currency: 'USD',
          status: 'pending',
          paymentId: token,
          provider: 'xsolla',
          autoRenew: false,
        },
        update: {
          tier: tier.tier,
          levelName: tier.name,
          price: amount,
          paymentId: token,
          status: 'pending',
        },
      });

      this.logger.log(`User ${userId} initiated Xsolla payment token=${token}`);
      return { url, paymentId: token };
    } catch (err: any) {
      this.logger.error(`Xsolla create checkout failed: ${err.message}`);
      throw new BadRequestException('Payment initiation failed. Please try again.');
    }
  }

  async handleWebhook(rawBody: string, authHeader: string): Promise<any> {
    const xsollaService = this.xsolla;

    if (!xsollaService.verifyWebhookSignature(rawBody, authHeader)) {
      this.logger.error('Xsolla webhook signature verification failed — rejecting event');
      throw new BadRequestException('Invalid webhook signature');
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      this.logger.error('Failed to parse webhook body as JSON');
      return { received: true };
    }

    const notificationType = body.notification_type;
    this.logger.log(`Xsolla webhook: notification_type=${notificationType}`);

    if (notificationType === 'user_validation') {
      return {
        notification_type: 'user_validation',
        user: body.user,
        hasUser: true,
      };
    }

    if (notificationType === 'payment') {
      const userId = body.user?.id?.value;
      const status = body.payment?.status;
      const transactionId = body.transaction?.id;

      if (!userId || !status) {
        this.logger.warn('Xsolla payment webhook missing userId or status');
        return { received: true };
      }

      if (status === 'done') {
        const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        const existingSub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });

        if (existingSub?.status === 'active') {
          this.logger.log(`Xsolla payment ${transactionId} already processed — skipping`);
          return { received: true };
        }

        const tierName = existingSub?.levelName || 'PREMIUM_BASIC';
        const tier = this.getTierInfo(tierName);

        await this.prisma.$transaction([
          this.prisma.premiumSubscription.upsert({
            where: { userId },
            create: {
              userId,
              tier: tier.tier,
              levelName: tierName,
              endDate,
              price: body.purchase?.checkout?.amount || tier.price,
              currency: 'USD',
              status: 'active',
              paymentId: transactionId,
              provider: 'xsolla',
              autoRenew: false,
            },
            update: {
              status: 'active',
              tier: tier.tier,
              levelName: tierName,
              endDate,
              paymentId: transactionId,
            },
          }),
          this.prisma.user.update({
            where: { id: userId },
            data: { subscription: tierName, subscriptionEnd: endDate },
          }),
        ]);

        this.logger.log(`User ${userId} subscribed to ${tierName} via Xsolla`);
      } else if (status === 'canceled' || status === 'failed') {
        await this.prisma.premiumSubscription.updateMany({
          where: { userId, status: 'pending' },
          data: { status: 'cancelled' },
        });
      }
    }

    return { received: true };
  }

  async cancelSubscription(userId: string) {
    await this.prisma.$transaction([
      this.prisma.premiumSubscription.updateMany({
        where: { userId, status: 'active' },
        data: { status: 'cancelled', autoRenew: false },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { subscription: 'FREE', subscriptionEnd: null },
      }),
    ]);
    return { cancelled: true };
  }

  async getMySubscription(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { subscription: true, subscriptionEnd: true },
    });
    const sub = await this.prisma.premiumSubscription.findUnique({
      where: { userId },
    });
    const tierInfo = this.getTierInfo(user?.subscription || 'FREE');
    return {
      tier: tierInfo.tier,
      name: user?.subscription || 'FREE',
      label: tierInfo.label_en,
      endDate: user?.subscriptionEnd,
      maxGroups: tierInfo.maxGroups,
      canCreateGroups: tierInfo.canCreateGroups,
      canReceiveReports: tierInfo.canReceiveReports,
      active: sub?.status === 'active' && (!user?.subscriptionEnd || user.subscriptionEnd > new Date()),
      paymentId: sub?.paymentId,
      provider: sub?.provider || 'xsolla',
    };
  }
}
