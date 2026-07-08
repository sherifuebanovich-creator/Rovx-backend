import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

export const PREMIUM_TIERS = [
  { tier: 0, name: 'FREE', price: 0, maxGroups: 0, canCreateGroups: false, canReceiveReports: false, label_en: 'Free', label_ru: 'Бесплатно' },
  { tier: 1, name: 'PREMIUM_BASIC', price: 4.99, maxGroups: 1, canCreateGroups: false, canReceiveReports: true, label_en: 'Premium Basic', label_ru: 'Premium Basic' },
  { tier: 2, name: 'PREMIUM_STANDARD', price: 9.99, maxGroups: 3, canCreateGroups: false, canReceiveReports: true, label_en: 'Premium Standard', label_ru: 'Premium Standard' },
  { tier: 3, name: 'PREMIUM_MAX', price: 19.99, maxGroups: 10, canCreateGroups: true, canReceiveReports: true, label_en: 'Premium Max', label_ru: 'Premium Max' },
] as const;

export type PremiumTier = typeof PREMIUM_TIERS[number];

@Injectable()
export class PremiumService {
  private readonly logger = new Logger(PremiumService.name);
  private readonly apiKey: string;
  private readonly offerId: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.apiKey = this.config.get('LAVA_API_KEY', '');
    this.offerId = this.config.get('LAVA_OFFER_ID_V2', 'af64d6fe-b677-47e1-a9a3-9777fb2e6b58');
  }

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
    if (!this.apiKey || !this.offerId) {
      throw new BadRequestException('Lava payment is not configured');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const amount = +(tier.price * months).toFixed(2);

    try {
      const res = await axios.post('https://gate.lava.top/api/v3/invoice',
        {
          email: user.email,
          offerId: this.offerId,
          currency: 'RUB',
          amount: amount,
        },
        {
          headers: {
            'X-Api-Key': this.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          timeout: 15000,
        },
      );

      const invoiceId = res.data.id;
      const paymentUrl = res.data.paymentUrl || '';

      await this.prisma.premiumSubscription.upsert({
        where: { userId },
        create: {
          userId,
          tier: tier.tier,
          levelName: tier.name,
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          price: amount,
          currency: 'RUB',
          status: 'pending',
          paymentId: invoiceId,
          provider: 'lava',
          autoRenew: false,
        },
        update: {
          tier: tier.tier,
          levelName: tier.name,
          price: amount,
          paymentId: invoiceId,
          status: 'pending',
        },
      });

      this.logger.log(`User ${userId} initiated Lava payment ${invoiceId}`);
      return { url: paymentUrl, paymentId: invoiceId };
    } catch (err: any) {
      this.logger.error(`Lava create payment failed: ${err.message}`);
      throw new BadRequestException('Payment initiation failed. Please try again.');
    }
  }

  async handleWebhook(body: any): Promise<void> {
    const { eventType, contractId } = body;
    if (!eventType || !contractId) return;

    this.logger.log(`Lava webhook: event=${eventType}, contract=${contractId}`);

    if (eventType === 'payment.success') {
      const sub = await this.prisma.premiumSubscription.findFirst({
        where: { paymentId: contractId },
      });
      if (!sub) {
        this.logger.warn(`No subscription for contract ${contractId}`);
        return;
      }
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await this.prisma.$transaction([
        this.prisma.premiumSubscription.update({
          where: { id: sub.id },
          data: { status: 'active', endDate },
        }),
        this.prisma.user.update({
          where: { id: sub.userId },
          data: { subscription: sub.levelName, subscriptionEnd: endDate },
        }),
      ]);
      this.logger.log(`User ${sub.userId} subscribed to ${sub.levelName} via Lava`);
    }

    if (eventType === 'payment.failed') {
      const sub = await this.prisma.premiumSubscription.findFirst({
        where: { paymentId: contractId },
      });
      if (sub) {
        await this.prisma.premiumSubscription.update({
          where: { id: sub.id },
          data: { status: 'cancelled' },
        });
      }
    }
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
      provider: sub?.provider || 'lava',
    };
  }
}
