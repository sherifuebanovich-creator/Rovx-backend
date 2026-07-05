import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';

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
  private stripe: Stripe | null = null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const stripeKey = this.config.get('STRIPE_SECRET_KEY');
    if (stripeKey) {
      this.stripe = new Stripe(stripeKey, { apiVersion: '2026-06-24.dahlia' });
    }
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

  async createCheckoutSession(userId: string, tierName: string, months: number = 1): Promise<{ url: string; sessionId: string }> {
    const tier = PREMIUM_TIERS.find(t => t.name === tierName);
    if (!tier || tier.tier === 0) {
      throw new BadRequestException('Invalid tier');
    }
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email,
      client_reference_id: userId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: tier.label_en,
              description: `${tier.label_en} - ${months} month(s)`,
            },
            unit_amount: Math.round(tier.price * months * 100),
          },
          quantity: 1,
        },
      ],
      metadata: { userId, tierName, months: String(months) },
      success_url: `${this.config.get('FRONTEND_URL', 'http://localhost:3000')}/premium?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.config.get('FRONTEND_URL', 'http://localhost:3000')}/premium?canceled=true`,
    });

    return { url: session.url!, sessionId: session.id };
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    if (!this.stripe) throw new BadRequestException('Stripe not configured');
    const webhookSecret = this.config.get('STRIPE_WEBHOOK_SECRET');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret!);
    } catch (err: any) {
      throw new BadRequestException(`Webhook signature verification failed: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const tierName = session.metadata?.tierName;
      const months = parseInt(session.metadata?.months || '1', 10);
      if (userId && tierName) {
        await this.activateSubscription(userId, tierName, months, session.id);
      }
    }
  }

  private async activateSubscription(userId: string, tierName: string, months: number, paymentId: string): Promise<any> {
    const tier = PREMIUM_TIERS.find(t => t.name === tierName);
    if (!tier) throw new BadRequestException('Invalid tier');

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);

    const existing = await this.prisma.premiumSubscription.findUnique({ where: { userId } });

    if (existing) {
      await this.prisma.premiumSubscription.update({
        where: { userId },
        data: {
          tier: tier.tier,
          levelName: tier.name,
          endDate,
          price: tier.price * months,
          status: 'active',
          paymentId,
          currency: 'USD',
        },
      });
    } else {
      await this.prisma.premiumSubscription.create({
        data: {
          userId,
          tier: tier.tier,
          levelName: tier.name,
          endDate,
          price: tier.price * months,
          status: 'active',
          paymentId,
          currency: 'USD',
        },
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { subscription: tier.name, subscriptionEnd: endDate },
    });

    this.logger.log(`User ${userId} subscribed to ${tier.name} via Stripe (${paymentId})`);
  }

  async cancelSubscription(userId: string) {
    await this.prisma.premiumSubscription.updateMany({
      where: { userId, status: 'active' },
      data: { status: 'cancelled', autoRenew: false },
    });
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
    };
  }
}
