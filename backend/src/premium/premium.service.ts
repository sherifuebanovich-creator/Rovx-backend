import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { XsollaService } from './xsolla.service';
import { LavaTopService } from './lava-top.service';
import { LemonSqueezyService } from './lemon-squeezy.service';
import { StripeService } from './stripe.service';
import { PaymeService } from './payme.service';

export const PREMIUM_TIERS = [
  {
    tier: 0, name: 'FREE', price: 0, maxGroups: 0,
    canCreateGroups: false, canReceiveReports: false,
    label_en: 'Free', label_ru: 'Бесплатно',
    desc_en: 'Basic navigation with no additional features',
    desc_ru: 'Базовая навигация без дополнительных функций',
  },
  {
    tier: 1, name: 'PREMIUM_BASIC', price: 5, maxGroups: 1, priceRub: 449, priceKzt: 2290, priceUzs: 49900,
    canCreateGroups: false, canReceiveReports: true,
    label_en: 'Premium Basic', label_ru: 'Премиум Базовый',
    desc_en: 'Ad-free navigation with instant road reports and voice guidance',
    desc_ru: 'Навигация без рекламы с мгновенными репортами и голосовыми подсказками',
  },
  {
    tier: 2, name: 'PREMIUM_STANDARD', price: 10, maxGroups: 3, priceRub: 899, priceKzt: 4490, priceUzs: 99900,
    canCreateGroups: false, canReceiveReports: true,
    label_en: 'Premium Standard', label_ru: 'Премиум Стандарт',
    desc_en: 'AI co-driver, live cameras & traffic, plus city group chats',
    desc_ru: 'AI-ассистент, камеры и пробки онлайн, городские чаты и группы',
  },
  {
    tier: 3, name: 'PREMIUM_MAX', price: 20, maxGroups: 10, priceRub: 1699, priceKzt: 8990, priceUzs: 199900,
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
    private stripeService: StripeService,
    private paymeService: PaymeService,
  ) {}

  isStripeConfigured(): boolean {
    return this.stripeService.configured;
  }

  verifyStripeWebhook(rawBody: string | Buffer, signature: string): any {
    return this.stripeService.verifyWebhookSignature(rawBody, signature);
  }

  verifyLemonSqueezyWebhook(rawBody: string, signature: string): boolean {
    return this.lemonSqueezy.verifyWebhookSignature(rawBody, signature);
  }

  verifyLavaTopWebhook(rawBody: string, signature: string): boolean {
    return this.lavaTop.verifyWebhookSignature(rawBody, signature);
  }

  isYooKassaConfigured(): boolean {
    return this.yooKassa.configured;
  }

  async createYooKassaCheckout(userId: string, tierName: string, currency = 'RUB') {
    const tier = PREMIUM_TIERS.find(t => t.name === tierName);
    if (!tier || tier.tier === 0) throw new BadRequestException('Invalid tier');

    const existing = await this.prisma.premiumSubscription.findUnique({ where: { userId } });
    if (existing?.status === 'active' && existing.endDate > new Date()) {
      throw new BadRequestException('Уже есть активная подписка');
    }

    const frontendUrl = this.config.get('FRONTEND_URL', 'https://rovx-app-livid.vercel.app');
    const amount = currency === 'RUB' ? (tier as any).priceRub || tier.price * 90 : tier.price;

    const { paymentId, confirmationUrl } = await this.yooKassa.createPayment({
      amount,
      currency,
      description: `ROVX ${tier.label_ru} — 30 дней`,
      userId,
      tierName: tier.name,
      returnUrl: `${frontendUrl}/premium?success=true`,
    });

    await this.prisma.premiumSubscription.upsert({
      where: { userId },
      create: {
        userId,
        tier: tier.tier,
        levelName: tier.name,
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        price: amount,
        currency,
        paymentId,
        status: 'pending',
      },
      update: {
        tier: tier.tier,
        levelName: tier.name,
        price: amount,
        currency,
        paymentId,
        status: 'pending',
      },
    });

    return { paymentId, confirmationUrl, amount, currency };
  }

  async handleYooKassaWebhook(body: any) {
    const event = this.yooKassa.parseWebhookEvent(body);
    if (!event) return;

    this.logger.log(`YooKassa webhook: ${event.event} — ${event.paymentId} (${event.status})`);

    if (event.event === 'payment.succeeded' && event.status === 'succeeded') {
      const existing = await this.prisma.premiumSubscription.findFirst({
        where: { paymentId: event.paymentId },
      });
      if (existing?.status === 'active') return;

      const userId = event.userId || existing?.userId;
      if (!userId) return;

      const tier = PREMIUM_TIERS.find(t => t.name === event.tierName) || PREMIUM_TIERS[1];
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await this.prisma.$transaction([
        this.prisma.premiumSubscription.upsert({
          where: { userId },
          create: {
            userId,
            tier: tier.tier,
            levelName: tier.name,
            startDate: new Date(),
            endDate,
            price: event.amount || 0,
            currency: event.currency || 'RUB',
            paymentId: event.paymentId,
            status: 'active',
          },
          update: {
            tier: tier.tier,
            levelName: tier.name,
            endDate,
            price: event.amount || 0,
            currency: event.currency || 'RUB',
            paymentId: event.paymentId,
            status: 'active',
          },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: {
            subscription: tier.name,
            subscriptionEnd: endDate,
          },
        }),
      ]);

      this.logger.log(`YooKassa payment confirmed: user ${userId} → ${tier.name}`);
    }
  }

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
    if (!this.xsolla.verifyWebhookSignature(rawBody, authHeader)) {
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

        const paidAmount = parseFloat(body.purchase?.checkout?.amount) || 0;
        const matchedTier = [...PREMIUM_TIERS].reverse().find(t => t.price <= paidAmount);
        const tierName = matchedTier?.name || existingSub?.levelName || 'PREMIUM_BASIC';
        if (matchedTier && matchedTier.price > 0) {
          this.logger.log(`Xsolla: detected tier ${tierName} from paid amount ${paidAmount}`);
        }
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
        await this.prisma.$transaction([
          this.prisma.premiumSubscription.update({
            where: { userId: sub.userId },
            data: { status: 'cancelled' },
          }),
          this.prisma.user.update({
            where: { id: sub.userId },
            data: { subscription: 'FREE', subscriptionEnd: null },
          }),
        ]);
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

  async createStripeCheckout(userId: string, tierName: string): Promise<{ url: string; sessionId: string }> {
    const tier = PREMIUM_TIERS.find(t => t.name === tierName);
    if (!tier || tier.tier === 0) {
      throw new BadRequestException('Invalid tier');
    }

    if (!this.stripeService.configured) {
      throw new BadRequestException('Stripe is not configured');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const existingSub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });
    if (existingSub?.status === 'active') {
      throw new BadRequestException('Already subscribed');
    }

    return this.stripeService.createCheckoutSession({
      email: user.email,
      tierName: tier.name,
      tierLabel: tier.label_en,
      amount: tier.price,
      currency: 'USD',
      userId,
    });
  }

  async handleStripeWebhook(event: any): Promise<void> {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const tierName = session.metadata?.tierName;

      if (!userId || !tierName) {
        this.logger.error('Stripe webhook missing metadata');
        return;
      }

      const tier = PREMIUM_TIERS.find(t => t.name === tierName);
      if (!tier) return;

      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const paymentId = `stripe_${session.id}`;

      await this.prisma.$transaction([
        this.prisma.premiumSubscription.upsert({
          where: { userId },
          create: {
            userId,
            tier: tier.tier,
            levelName: tier.name,
            endDate,
            price: tier.price,
            currency: 'USD',
            status: 'active',
            paymentId,
            autoRenew: false,
          },
          update: {
            status: 'active',
            tier: tier.tier,
            levelName: tier.name,
            endDate,
            paymentId,
          },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: { subscription: tierName, subscriptionEnd: endDate },
        }),
      ]);

      this.logger.log(`Stripe payment confirmed: user=${userId} tier=${tierName}`);

      try {
        const adminChat = this.config.get('TELEGRAM_CHAT_ID');
        const botToken = this.config.get('TELEGRAM_BOT_TOKEN');
        if (adminChat && botToken) {
          const user = await this.prisma.user.findUnique({ where: { id: userId } });
          const msg = `💰 <b>ОПЛАТА (Stripe)</b>\n\n` +
            `👤 Пользователь: <b>${user?.displayName || user?.email || userId}</b>\n` +
            `💎 Тариф: <b>${tier.label_en}</b>\n` +
            `💵 Сумма: <b>$${tier.price}</b>\n` +
            `📅 Активен до: ${endDate.toLocaleDateString('ru-RU')}`;
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: adminChat, text: msg, parse_mode: 'HTML' }),
            signal: AbortSignal.timeout(10000),
          });
        }
      } catch {}
    }
  }

  async getPaymentDetails() {
    return {
      cardNumber: this.config.get('PAYMENT_CARD_NUMBER') || '5614 6805 7053 0846',
      cardHolder: this.config.get('PAYMENT_CARD_HOLDER') || 'N/S Uzcard',
      cardBank: this.config.get('PAYMENT_CARD_BANK') || 'UzCard',
      amount: this.config.get('PAYMENT_AMOUNT') || '6.49',
      currency: this.config.get('PAYMENT_CURRENCY') || 'USD',
    };
  }

  async confirmDirectPayment(userId: string, tierName: string, proof: string): Promise<{ success: boolean; message: string; status: string }> {
    const tier = PREMIUM_TIERS.find(t => t.name === tierName);
    if (!tier || tier.tier === 0) {
      throw new BadRequestException('Invalid tier');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const existingSub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });
    if (existingSub?.status === 'active') {
      return { success: true, message: 'Already active', status: 'active' };
    }

    const paymentId = `direct_${Date.now()}_${userId.slice(0, 8)}`;

    await this.prisma.premiumSubscription.upsert({
      where: { userId },
      create: {
        userId,
        tier: tier.tier,
        levelName: tier.name,
        endDate: new Date(0),
        price: tier.price,
        currency: 'USD',
        status: 'pending',
        paymentId,
        autoRenew: false,
      },
      update: {
        status: 'pending',
        tier: tier.tier,
        levelName: tier.name,
        endDate: new Date(0),
        paymentId,
      },
    });

    this.logger.log(`Direct payment confirmed: user=${userId} tier=${tierName} proof=${proof}`);

    try {
      const adminChat = this.config.get('TELEGRAM_CHAT_ID');
      const botToken = this.config.get('TELEGRAM_BOT_TOKEN');
      if (adminChat && botToken) {
        const msg = `💰 <b>НОВАЯ ОПЛАТА</b>\n\n` +
          `👤 Пользователь: <b>${user.displayName || user.email || userId}</b>\n` +
          `💎 Тариф: <b>${tier.label_ru}</b>\n` +
          `💵 Сумма: <b>${(tier as any).priceRub || '$' + tier.price}</b>\n` +
          `🔢 Последние 4 цифры карты: <b>${proof}</b>\n` +
          `⏳ Статус: <b>Ожидает подтверждения</b>\n\n` +
          `🆔 <code>${userId}</code>`;
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: adminChat,
            text: msg,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Одобрить', callback_data: `pay_approve_${userId}` },
                  { text: '❌ Отклонить', callback_data: `pay_reject_${userId}` },
                ],
              ],
            },
          }),
          signal: AbortSignal.timeout(10000),
        });
      }
    } catch (e) {
      this.logger.warn(`Failed to send admin payment notification: ${e}`);
    }

    return { success: true, message: `Платёж принят! Ожидает подтверждения администратором. Обычно до 30 минут.`, status: 'pending' };
  }

  async approvePayment(userId: string): Promise<{ success: boolean; message: string }> {
    const sub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });
    if (!sub || sub.status !== 'pending') {
      return { success: false, message: 'Нет ожидающего платежа' };
    }

    const endDate = (sub.endDate && sub.endDate.getTime() > 0) ? sub.endDate : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.premiumSubscription.update({
        where: { userId },
        data: { status: 'active' },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { subscription: sub.levelName, subscriptionEnd: endDate },
      }),
    ]);

    return { success: true, message: `Подписка ${sub.levelName} активирована для пользователя` };
  }

  async rejectPayment(userId: string): Promise<{ success: boolean; message: string }> {
    const sub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });
    if (!sub || sub.status !== 'pending') {
      return { success: false, message: 'Нет ожидающего платежа' };
    }

    await this.prisma.$transaction([
      this.prisma.premiumSubscription.delete({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { subscription: 'FREE', subscriptionEnd: null },
      }),
    ]);

    return { success: true, message: `Платёж отклонён, подписка сброшена` };
  }

  async getPendingPayments() {
    const subs = await this.prisma.premiumSubscription.findMany({
      where: { status: 'pending' },
      include: { user: { select: { displayName: true, email: true, username: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return subs;
  }

  async getAllUsers(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        select: {
          id: true,
          displayName: true,
          email: true,
          username: true,
          subscription: true,
          subscriptionEnd: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count(),
    ]);
    return { users, total, page, pages: Math.ceil(total / limit) };
  }

  async findUser(query: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: { contains: query, mode: 'insensitive' } },
          { username: { contains: query, mode: 'insensitive' } },
          { displayName: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        username: true,
        subscription: true,
        subscriptionEnd: true,
        createdAt: true,
        _count: { select: { reports: true } },
      },
    });
    return user;
  }

  async deactivateUser(userId: string) {
    await this.prisma.premiumSubscription.updateMany({
      where: { userId },
      data: { status: 'cancelled' },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { subscription: 'FREE', subscriptionEnd: null },
    });
    return { success: true };
  }

  async getAdminStats() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalUsers, activeSubs, pendingPayments, todayPayments, weekPayments, monthPayments, totalRevenue] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.premiumSubscription.count({ where: { status: 'active' } }),
      this.prisma.premiumSubscription.count({ where: { status: 'pending' } }),
      this.prisma.premiumSubscription.count({ where: { createdAt: { gte: today } } }),
      this.prisma.premiumSubscription.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.premiumSubscription.count({ where: { createdAt: { gte: monthAgo } } }),
      this.prisma.premiumSubscription.aggregate({ where: { status: 'active' }, _sum: { price: true } }),
    ]);

    return {
      totalUsers,
      activeSubs,
      pendingPayments,
      todayPayments,
      weekPayments,
      monthPayments,
      totalRevenue: totalRevenue._sum.price || 0,
    };
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
