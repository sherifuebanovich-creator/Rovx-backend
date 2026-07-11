import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { XsollaService } from './xsolla.service';
import { LavaTopService } from './lava-top.service';
import { LemonSqueezyService } from './lemon-squeezy.service';

export const PREMIUM_TIERS = [
  {
    tier: 0, name: 'FREE', price: 0, maxGroups: 0,
    canCreateGroups: false, canReceiveReports: false,
    label_en: 'Free', label_ru: 'Бесплатно',
    desc_en: 'Basic navigation with no additional features',
    desc_ru: 'Базовая навигация без дополнительных функций',
  },
  {
    tier: 1, name: 'PREMIUM_BASIC', price: 5, maxGroups: 1,
    canCreateGroups: false, canReceiveReports: true,
    label_en: 'Premium Basic', label_ru: 'Премиум Базовый',
    desc_en: 'Ad-free navigation with instant road reports and voice guidance',
    desc_ru: 'Навигация без рекламы с мгновенными репортами и голосовыми подсказками',
  },
  {
    tier: 2, name: 'PREMIUM_STANDARD', price: 10, maxGroups: 3,
    canCreateGroups: false, canReceiveReports: true,
    label_en: 'Premium Standard', label_ru: 'Премиум Стандарт',
    desc_en: 'AI co-driver, live cameras & traffic, plus city group chats',
    desc_ru: 'AI-ассистент, камеры и пробки онлайн, городские чаты и группы',
  },
  {
    tier: 3, name: 'PREMIUM_MAX', price: 20, maxGroups: 10,
    canCreateGroups: true, canReceiveReports: true,
    label_en: 'Premium Max', label_ru: 'Премиум Макс',
    desc_en: 'Unlimited AI, 3D maps, convoys, priority support — everything included',
    desc_ru: 'Безлимитный AI, 3D-карты, конвои, приоритетная поддержка — всё включено',
  },
] as const;

export type PremiumTier = typeof PREMIUM_TIERS[number];

@Injectable()
export class PremiumService {
  private readonly logger = new Logger(PremiumService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private xsolla: XsollaService,
    private lavaTop: LavaTopService,
    private lemonSqueezy: LemonSqueezyService,
  ) {}

  getTiers(lang = 'en') {
    return PREMIUM_TIERS.map(t => ({
      ...t,
      label: lang === 'ru' ? t.label_ru : t.label_en,
      description: lang === 'ru' ? t.desc_ru : t.desc_en,
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
      return { allowed: false, currentGroups: 0, maxGroups: 0, tier: tier.tier, tierRequired: maxTier.label_en };
    }
    const groupCount = await this.prisma.group.count({ where: { ownerId: userId } });
    const allowed = groupCount < tier.maxGroups;
    return { allowed, currentGroups: groupCount, maxGroups: tier.maxGroups, tier: tier.tier, tierRequired: maxTier.label_en };
  }

  async createCheckoutSession(userId: string, tierName: string, months: number = 1, lang: string = 'ru'): Promise<{ url: string; paymentId: string }> {
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
      const xsollaLang = lang?.startsWith('ru') ? 'ru' : 'en';

      const { token, url } = await this.xsolla.createPaymentToken({
        userId,
        email: user.email,
        userName: user.displayName || user.username || user.email,
        tierName,
        tierPrice: tier.price,
        months,
        language: xsollaLang,
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

  async createLavaTopCheckout(userId: string, tierName: string): Promise<{ url: string; invoiceId: string }> {
    const tier = PREMIUM_TIERS.find(t => t.name === tierName);
    if (!tier || tier.tier === 0) {
      throw new BadRequestException('Invalid tier');
    }

    if (!this.lavaTop.configured) {
      throw new BadRequestException('Lava.top payment is not configured');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const offerId = this.config.get('LAVA_TOP_OFFER_ID');
    if (!offerId) throw new BadRequestException('LAVA_TOP_OFFER_ID not configured');

    const { invoiceUrl, invoiceId } = await this.lavaTop.createInvoice({
      email: user.email,
      offerId,
      amount: tier.price,
      currency: 'RUB',
    });

    await this.prisma.premiumSubscription.upsert({
      where: { userId },
      create: {
        userId,
        tier: tier.tier,
        levelName: tier.name,
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        price: tier.price,
        currency: 'RUB',
        status: 'pending',
        paymentId: invoiceId,
        autoRenew: false,
      },
      update: {
        tier: tier.tier,
        levelName: tier.name,
        price: tier.price,
        paymentId: invoiceId,
        status: 'pending',
      },
    });

    this.logger.log(`User ${userId} initiated lava.top invoice=${invoiceId}`);
    return { url: invoiceUrl, invoiceId };
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

  async handleLavaTopWebhook(body: any): Promise<any> {
    const eventType = body.eventType || body.event_type;
    const status = body.status;
    const invoiceId = body.invoiceId || body.invoice_id;

    this.logger.log(`Lava.top webhook: event=${eventType} status=${status} invoice=${invoiceId}`);

    if (eventType === 'payment.success' || status === 'success') {
      const email = body.buyer?.email || body.email;
      if (!email) {
        this.logger.warn('Lava.top webhook missing buyer email');
        return { received: true };
      }

      const user = await this.prisma.user.findFirst({ where: { email } });
      if (!user) {
        this.logger.warn(`Lava.top webhook: user not found for email ${email}`);
        return { received: true };
      }

      const existingSub = await this.prisma.premiumSubscription.findUnique({ where: { userId: user.id } });
      if (existingSub?.status === 'active') {
        this.logger.log(`Lava.top invoice ${invoiceId} already processed — skipping`);
        return { received: true };
      }

      const tierName = existingSub?.levelName || 'PREMIUM_BASIC';
      const tier = this.getTierInfo(tierName);
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await this.prisma.$transaction([
        this.prisma.premiumSubscription.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            tier: tier.tier,
            levelName: tierName,
            endDate,
            price: body.amount || tier.price,
            currency: 'RUB',
            status: 'active',
            paymentId: invoiceId,
            autoRenew: false,
          },
          update: {
            status: 'active',
            tier: tier.tier,
            levelName: tierName,
            endDate,
            paymentId: invoiceId,
          },
        }),
        this.prisma.user.update({
          where: { id: user.id },
          data: { subscription: tierName, subscriptionEnd: endDate },
        }),
      ]);

      this.logger.log(`User ${user.id} subscribed to ${tierName} via lava.top`);
    } else if (status === 'failed' || status === 'cancelled') {
      const sub = await this.prisma.premiumSubscription.findFirst({
        where: { paymentId: invoiceId },
      });
      if (sub) {
        await this.prisma.premiumSubscription.update({
          where: { userId: sub.userId },
          data: { status: 'cancelled' },
        });
      }
    }

    return { received: true };
  }

  async createLemonSqueezyCheckout(userId: string, tierName: string): Promise<{ url: string; checkoutId: string }> {
    const tier = PREMIUM_TIERS.find(t => t.name === tierName);
    if (!tier || tier.tier === 0) {
      throw new BadRequestException('Invalid tier');
    }

    if (!this.lemonSqueezy.configured) {
      throw new BadRequestException('Lemon Squeezy payment is not configured');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const amountInCents = tier.price * 100;

    try {
      const { checkoutUrl, checkoutId } = await this.lemonSqueezy.createCheckout({
        email: user.email,
        userId,
        amount: amountInCents,
        productName: `ROVX Premium - ${tier.label_en}`,
      });

      await this.prisma.premiumSubscription.upsert({
        where: { userId },
        create: {
          userId,
          tier: tier.tier,
          levelName: tier.name,
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          price: tier.price,
          currency: 'USD',
          status: 'pending',
          paymentId: checkoutId,
          autoRenew: false,
        },
        update: {
          tier: tier.tier,
          levelName: tier.name,
          price: tier.price,
          paymentId: checkoutId,
          status: 'pending',
        },
      });

      this.logger.log(`User ${userId} initiated Lemon Squeezy checkout=${checkoutId}`);
      return { url: checkoutUrl, checkoutId };
    } catch (err: any) {
      this.logger.error(`Lemon Squeezy checkout failed: ${err.message}`);
      throw new BadRequestException('Payment initiation failed. Please try again.');
    }
  }

  async handleLemonSqueezyWebhook(body: any): Promise<any> {
    const eventName = body?.meta?.event_name;
    const orderData = body?.data?.attributes;

    this.logger.log(`Lemon Squeezy webhook: event=${eventName} status=${orderData?.status}`);

    if (eventName === 'order_created' && orderData?.status === 'success') {
      const customData = orderData?.checkout_data?.custom || {};
      const userId = customData.user_id;
      const orderId = body?.data?.id;

      if (!userId) {
        this.logger.warn('Lemon Squeezy webhook missing user_id in custom data');
        return { received: true };
      }

      const existingSub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });
      if (existingSub?.status === 'active') {
        this.logger.log(`Lemon Squeezy order ${orderId} already processed — skipping`);
        return { received: true };
      }

      const tierName = existingSub?.levelName || 'PREMIUM_BASIC';
      const tier = this.getTierInfo(tierName);
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await this.prisma.$transaction([
        this.prisma.premiumSubscription.upsert({
          where: { userId },
          create: {
            userId,
            tier: tier.tier,
            levelName: tierName,
            endDate,
            price: orderData?.total || tier.price,
            currency: 'USD',
            status: 'active',
            paymentId: orderId,
            autoRenew: false,
          },
          update: {
            status: 'active',
            tier: tier.tier,
            levelName: tierName,
            endDate,
            paymentId: orderId,
          },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: { subscription: tierName, subscriptionEnd: endDate },
        }),
      ]);

      this.logger.log(`User ${userId} subscribed to ${tierName} via Lemon Squeezy`);
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
    };
  }
}
