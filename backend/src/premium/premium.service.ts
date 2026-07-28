import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { XsollaService } from './xsolla.service';
import { LemonSqueezyService } from './lemon-squeezy.service';
import { StripeService } from './stripe.service';
import { escapeTelegramHtml } from '../common/utils/telegram.util';

export const PREMIUM_TIERS = [
  {
    tier: 0, name: 'FREE', price: 0, maxGroups: 0, supportLimit: 1,
    canCreateGroups: false, canReceiveReports: false,
    label_en: 'Free', label_ru: 'Бесплатно',
    desc_en: 'Basic navigation with no additional features',
    desc_ru: 'Базовая навигация без дополнительных функций',
  },
  {
    tier: 1, name: 'PREMIUM_BASIC', price: 5, maxGroups: 1, priceRub: 449, priceKzt: 2290, priceUzs: 49900, supportLimit: 3,
    canCreateGroups: false, canReceiveReports: true,
    label_en: 'Premium Basic', label_ru: 'Премиум Базовый',
    desc_en: 'Navigation with instant road reports, voice guidance, a real-time AI Co-Driver, live traffic lights/radars/cameras, and weather & traffic along your route',
    desc_ru: 'Навигация: мгновенные репорты, голосовые подсказки, AI-ассистент Co-Driver в реальном времени, светофоры/радары/камеры онлайн, погода и пробки по маршруту',
  },
  {
    tier: 2, name: 'PREMIUM_STANDARD', price: 10, maxGroups: 3, priceRub: 899, priceKzt: 4490, priceUzs: 99900, supportLimit: 5,
    canCreateGroups: true, canReceiveReports: true,
    label_en: 'Premium Standard', label_ru: 'Премиум Стандарт',
    desc_en: 'Everything in Basic, plus city group chats and groups',
    desc_ru: 'Всё из Базового, плюс городские чаты и группы',
  },
  {
    tier: 3, name: 'PREMIUM_MAX', price: 20, maxGroups: 10, priceRub: 1699, priceKzt: 8990, priceUzs: 199900, supportLimit: 10,
    canCreateGroups: true, canReceiveReports: true,
    label_en: 'Premium Max', label_ru: 'Премиум Макс',
    desc_en: 'Unlimited AI, convoys, priority support — everything included',
    desc_ru: 'Безлимитный AI, конвои, приоритетная поддержка — всё включено',
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
    private lemonSqueezy: LemonSqueezyService,
    private stripeService: StripeService,
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

  isYooKassaConfigured(): boolean {
    return false;
  }

  async createYooKassaCheckout(userId: string, tierName: string, currency = 'RUB') {
    throw new BadRequestException('YooKassa is not configured');
  }

  async handleYooKassaWebhook(body: any) {
    return { received: true };
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

  // A renewal paid before the current period expires must ADD time on top
  // of what's left, not overwrite it with a fresh 30-day window from now —
  // otherwise a user with e.g. 20 days remaining who renews loses those 20
  // days the moment the webhook fires. `user.subscriptionEnd` (not the
  // shared, checkout-mutated `premiumSubscription` row) is the only
  // reliable "currently entitled until" signal — see getMySubscription.
  private async extendedEndDate(userId: string, months: number): Promise<Date> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { subscriptionEnd: true } });
    const now = new Date();
    const base = user?.subscriptionEnd && user.subscriptionEnd > now ? user.subscriptionEnd : now;
    return new Date(base.getTime() + 30 * months * 24 * 60 * 60 * 1000);
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
    // Lowest tier that actually grants group creation — was hardcoded to
    // the top tier (Max), so the error message told Standard users they
    // needed Max even after Standard gained canCreateGroups.
    const requiredTier = PREMIUM_TIERS.find(t => t.canCreateGroups) ?? PREMIUM_TIERS[PREMIUM_TIERS.length - 1];
    if (!tier.canCreateGroups) {
      return { allowed: false, currentGroups: 0, maxGroups: 0, tier: tier.tier, tierRequired: requiredTier.label_en };
    }
    const groupCount = await this.prisma.group.count({ where: { ownerId: userId } });
    const allowed = groupCount < tier.maxGroups;
    return { allowed, currentGroups: groupCount, maxGroups: tier.maxGroups, tier: tier.tier, tierRequired: requiredTier.label_en };
  }

  async createCheckoutSession(userId: string, tierName: string, months: number = 1, lang: string = 'ru'): Promise<{ url: string; paymentId: string }> {
    const tier = PREMIUM_TIERS.find(t => t.name === tierName);
    if (!tier || tier.tier === 0) {
      throw new BadRequestException('Invalid tier');
    }
    // `months` is client-supplied and flows straight into `amount = price *
    // months` and the HMAC-signed checkout token — 0 produces a $0
    // checkout, a negative value a negative one, with no floor/ceiling
    // before reaching Xsolla's API.
    if (!Number.isInteger(months) || months < 1 || months > 24) {
      throw new BadRequestException('months must be an integer between 1 and 24');
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
          months,
          endDate: new Date(Date.now() + 30 * months * 24 * 60 * 60 * 1000),
          price: amount,
          currency: 'USD',
          status: 'pending',
          paymentId: token,
          autoRenew: false,
        },
        update: {
          tier: tier.tier,
          levelName: tier.name,
          months,
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
        const existingSub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });

        // Idempotency: only skip a webhook redelivery for a transaction we've
        // already applied. Checking `status === 'active'` alone would also
        // silently swallow a legitimate renewal payment for the same user.
        if (existingSub?.status === 'active' && transactionId && existingSub.paymentId === transactionId) {
          this.logger.log(`Xsolla payment ${transactionId} already processed — skipping`);
          return { received: true };
        }

        // The tier/months are bound to THIS specific transaction via `custom_parameters`
        // set at token-creation time and echoed back verbatim inside the HMAC-signed
        // webhook body — this is the only tamper-proof source. `existingSub.levelName`
        // is a mutable row keyed by userId that a second, later checkout attempt for a
        // different tier can overwrite before the first one is paid, letting a user pay
        // for a cheap tier but get credited for whatever tier is currently sitting in
        // that row. Never derive the credited tier from it.
        const customParams = body.custom_parameters || {};
        const paidAmount = parseFloat(body.purchase?.checkout?.amount) || 0;
        let tierName = PREMIUM_TIERS.find(t => t.name === customParams.tier_name)?.name;
        const months = parseInt(customParams.months, 10) || 1;
        if (!tierName) {
          // Checkout charges tier.price * months (see createCheckoutSession above), so
          // matching against the per-month tier price requires dividing back out first —
          // otherwise a multi-month purchase gets guessed into a too-high tier. `t.tier > 0`
          // excludes FREE from the match — a $0/malformed webhook must be rejected below,
          // not silently resolve to "FREE" and get written as an active subscription.
          const matchedTier = [...PREMIUM_TIERS].reverse().find(t => t.tier > 0 && t.price <= paidAmount / months);
          tierName = matchedTier?.name;
          this.logger.warn(`Xsolla: payment ${transactionId} missing/invalid custom_parameters.tier_name for user ${userId}, guessed tier ${tierName || 'none'} from paid amount ${paidAmount} / ${months}mo`);
        }
        const tier = tierName ? this.getTierInfo(tierName) : null;
        // Cross-check the paid amount against the claimed/guessed tier's
        // price even when tier_name WAS present — previously this check only
        // ran as part of the fallback-guess path, so a webhook with a valid
        // tier_name but an amount below that tier's price (e.g. a
        // flexible-amount checkout config) was credited in full with no
        // verification at all. 2% tolerance absorbs FX rounding.
        if (!tier || tier.tier === 0 || paidAmount < tier.price * months * 0.98) {
          this.logger.error(`Xsolla payment ${transactionId} REJECTED: paid ${paidAmount} does not cover tier ${tierName || 'unknown'} x${months}mo for user ${userId}`);
          return { received: true };
        }
        const endDate = await this.extendedEndDate(userId, months);

        await this.prisma.$transaction([
          this.prisma.premiumSubscription.upsert({
            where: { userId },
            create: {
              userId,
              tier: tier.tier,
              levelName: tierName,
              months,
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
              // A renewal or tier change (e.g. after the prior subscription
              // expired) hits this `update` branch, not `create` — without
              // refreshing `price` here it stays stuck at whatever the last
              // tier/provider wrote, skewing getAdminStats' totalRevenue sum.
              price: body.purchase?.checkout?.amount || tier.price,
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

    // A refund/chargeback must revoke premium — otherwise a refunded user
    // keeps access until subscriptionEnd naturally lapses. Only revoke if
    // the refunded transaction still matches the active subscription's
    // paymentId, so a stale/late refund for a superseded transaction can't
    // cancel a newer, already-paid subscription.
    if (notificationType === 'refund' || notificationType === 'chargeback') {
      const userId = body.user?.id?.value;
      const transactionId = body.transaction?.id;

      if (!userId) {
        this.logger.warn(`Xsolla ${notificationType} webhook missing userId`);
        return { received: true };
      }

      const existingSub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });
      // Must require an actual transactionId match here — `!transactionId ||`
      // would revoke ANY active subscription for this userId whenever the
      // webhook happens to omit transaction.id, contradicting the comment
      // above and unlike the matching Stripe/Lemon Squeezy revoke checks
      // just below, which always require the id to match before revoking.
      if (existingSub?.status === 'active' && transactionId && existingSub.paymentId === transactionId) {
        await this.prisma.$transaction([
          this.prisma.premiumSubscription.update({
            where: { userId },
            data: { status: 'refunded', autoRenew: false },
          }),
          this.prisma.user.update({
            where: { id: userId },
            data: { subscription: 'FREE', subscriptionEnd: null },
          }),
        ]);
        this.logger.warn(`Xsolla ${notificationType}: revoked premium for user ${userId} (transaction ${transactionId})`);
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
        tierName: tier.name,
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
      if (existingSub?.status === 'active' && orderId && existingSub.paymentId === String(orderId)) {
        this.logger.log(`Lemon Squeezy order ${orderId} already processed — skipping`);
        return { received: true };
      }

      // Bound to this specific order via `checkout_data.custom.tier_name`, which Lemon
      // Squeezy echoes back inside the HMAC-signed webhook body — not the mutable
      // `existingSub.levelName` row, which a later checkout for a different tier could
      // have overwritten before this order was paid.
      const paidAmount = (orderData?.total || 0) / 100;
      let tierName: string | undefined = PREMIUM_TIERS.find(t => t.name === customData.tier_name)?.name;
      if (!tierName) {
        // Same rule as Xsolla above — guess from the paid amount (Lemon Squeezy `total`
        // is in cents), never from `existingSub.levelName`, which a second checkout for
        // a different tier can overwrite before this order is confirmed paid. `t.tier > 0`
        // excludes FREE — a $0/malformed webhook must be rejected below, not resolve to it.
        const matchedTier = [...PREMIUM_TIERS].reverse().find(t => t.tier > 0 && t.price <= paidAmount);
        tierName = matchedTier?.name;
        this.logger.warn(`Lemon Squeezy: order ${orderId} missing/invalid custom_data.tier_name for user ${userId}, guessed tier ${tierName || 'none'} from paid amount ${paidAmount}`);
      }
      const tier = tierName ? this.getTierInfo(tierName) : null;
      // Cross-check the paid amount against the claimed/guessed tier's price
      // even when tier_name WAS present — a "pay what you want" variant
      // could otherwise credit the full tier for less than its price.
      if (!tier || tier.tier === 0 || paidAmount < tier.price * 0.98) {
        this.logger.error(`Lemon Squeezy order ${orderId} REJECTED: paid ${paidAmount} does not cover tier ${tierName || 'unknown'} for user ${userId}`);
        return { received: true };
      }
      const endDate = await this.extendedEndDate(userId, 1);

      await this.prisma.$transaction([
        this.prisma.premiumSubscription.upsert({
          where: { userId },
          create: {
            userId,
            tier: tier.tier,
            levelName: tierName,
            endDate,
            // `orderData.total` is in cents (see paidAmount above) — unlike
            // Xsolla/Stripe, which store the dollar amount in `price`, this
            // was storing the raw cents value, inflating admin's
            // getAdminStats totalRevenue sum 100x for Lemon Squeezy subs.
            price: orderData?.total ? orderData.total / 100 : tier.price,
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
            // Same reasoning as the Xsolla handler above: a renewal or tier
            // change hits `update`, not `create` — refresh `price` here too
            // or it stays stuck at whatever the last tier/provider wrote,
            // skewing getAdminStats' totalRevenue sum.
            price: orderData?.total ? orderData.total / 100 : tier.price,
            paymentId: orderId,
          },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: { subscription: tierName, subscriptionEnd: endDate },
        }),
      ]);

      this.logger.log(`User ${userId} subscribed to ${tierName} via Lemon Squeezy`);
      return { received: true };
    }

    // A refunded order must revoke premium — otherwise a refunded user keeps
    // access until subscriptionEnd naturally lapses. Only revoke if the
    // order id still matches the active subscription's paymentId, so a
    // stale/late refund for a superseded order can't cancel a newer,
    // already-paid subscription.
    if (eventName === 'order_refunded') {
      const customData = orderData?.checkout_data?.custom || {};
      const userId = customData.user_id;
      const orderId = body?.data?.id;

      if (!userId) {
        this.logger.warn('Lemon Squeezy order_refunded webhook missing user_id in custom data');
        return { received: true };
      }

      const existingSub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });
      if (existingSub?.status === 'active' && orderId && existingSub.paymentId === String(orderId)) {
        await this.prisma.$transaction([
          this.prisma.premiumSubscription.update({
            where: { userId },
            data: { status: 'refunded', autoRenew: false },
          }),
          this.prisma.user.update({
            where: { id: userId },
            data: { subscription: 'FREE', subscriptionEnd: null },
          }),
        ]);
        this.logger.warn(`Lemon Squeezy refund: revoked premium for user ${userId} (order ${orderId})`);
      }
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

    // Previously blocked any already-active user from starting a new Stripe
    // checkout at all ("Already subscribed") — unlike Xsolla/Lemon Squeezy,
    // which have no such guard and rely on extendedEndDate() to add time on
    // top of the current subscriptionEnd. The Stripe webhook handler below
    // already extends correctly (same extendedEndDate() call), so the only
    // bug was here: a user renewing early or switching tiers via Stripe was
    // hard-blocked until their subscription actually lapsed.

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

      // Only 'card' payment_method_types are enabled today, which never
      // completes this event before payment settles — but this event type
      // doesn't itself guarantee payment, only that checkout was completed
      // (e.g. a delayed/async method like a bank debit stays 'unpaid' here
      // and settles via a later event). Enabling such a method without this
      // check would grant premium for an unpaid session.
      if (session.payment_status !== 'paid') {
        this.logger.warn(`Stripe session ${session.id} completed but payment_status=${session.payment_status} — not granting premium yet`);
        return;
      }

      const tier = PREMIUM_TIERS.find(t => t.name === tierName);
      if (!tier) return;

      // Keyed by payment_intent (not session.id) so a later `charge.refunded`
      // event — which only carries the charge's payment_intent, never the
      // checkout session id — can be matched back to this same paymentId.
      const paymentId = session.payment_intent ? `stripe_${session.payment_intent}` : `stripe_${session.id}`;

      const existingSub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });
      if (existingSub?.status === 'active' && existingSub.paymentId === paymentId) {
        this.logger.log(`Stripe payment ${paymentId} already processed — skipping`);
        return;
      }

      const endDate = await this.extendedEndDate(userId, 1);

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
            // Stripe has no pre-webhook "pending" write (unlike Xsolla/Lemon
            // Squeezy's createCheckoutSession/createLemonSqueezyCheckout,
            // which upsert `price` at checkout-initiation time) — this
            // `update` branch is the ONLY place a Stripe payment ever
            // touches this row when one already exists (e.g. renewing after
            // the prior subscription expired, or switching tiers), so
            // without refreshing `price` here it stays stuck at whatever
            // tier/provider last wrote it, skewing getAdminStats'
            // totalRevenue sum by the stale amount instead of what was
            // actually charged this time.
            price: tier.price,
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
            `👤 Пользователь: <b>${escapeTelegramHtml(user?.displayName || user?.email || userId)}</b>\n` +
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
      return;
    }

    // A refund/chargeback on the underlying charge must revoke premium —
    // otherwise a refunded user keeps access until their subscriptionEnd
    // naturally lapses. Only revoke if this charge's paymentId still matches
    // the active subscription, so a stale/late refund notification for a
    // superseded payment can't cancel a newer, already-paid subscription.
    if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      const userId = charge.metadata?.userId;
      if (!userId) {
        this.logger.warn(`Stripe charge.refunded ${charge.id} missing userId metadata — cannot revoke premium`);
        return;
      }

      const paymentId = `stripe_${charge.payment_intent}`;
      const existingSub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });
      if (existingSub?.status === 'active' && existingSub.paymentId === paymentId) {
        await this.prisma.$transaction([
          this.prisma.premiumSubscription.update({
            where: { userId },
            data: { status: 'refunded', autoRenew: false },
          }),
          this.prisma.user.update({
            where: { id: userId },
            data: { subscription: 'FREE', subscriptionEnd: null },
          }),
        ]);
        this.logger.warn(`Stripe refund: revoked premium for user ${userId} (charge ${charge.id})`);
      }
      return;
    }

    // A chargeback (cardholder disputes the charge with their bank) must
    // revoke premium the same way a refund does — otherwise a disputed
    // payment keeps access until subscriptionEnd naturally lapses. Dispute
    // objects don't carry the charge's metadata directly, so the charge has
    // to be fetched from Stripe to recover the userId.
    if (event.type === 'charge.dispute.created') {
      const dispute = event.data.object;
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
      if (!chargeId) {
        this.logger.warn(`Stripe charge.dispute.created ${dispute.id} missing charge id`);
        return;
      }

      const charge = await this.stripeService.retrieveCharge(chargeId);
      const userId = charge?.metadata?.userId;
      if (!userId) {
        this.logger.warn(`Stripe charge.dispute.created ${dispute.id} (charge ${chargeId}) missing userId metadata — cannot revoke premium`);
        return;
      }

      const paymentId = `stripe_${charge!.payment_intent}`;
      const existingSub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });
      if (existingSub?.status === 'active' && existingSub.paymentId === paymentId) {
        await this.prisma.$transaction([
          this.prisma.premiumSubscription.update({
            where: { userId },
            data: { status: 'disputed', autoRenew: false },
          }),
          this.prisma.user.update({
            where: { id: userId },
            data: { subscription: 'FREE', subscriptionEnd: null },
          }),
        ]);
        this.logger.warn(`Stripe chargeback: revoked premium for user ${userId} (charge ${chargeId})`);
      }
    }
  }

  async getPaymentDetails() {
    const cardNumber = this.config.get('PAYMENT_CARD_NUMBER');
    const cardHolder = this.config.get('PAYMENT_CARD_HOLDER');
    const cardBank = this.config.get('PAYMENT_CARD_BANK');
    if (!cardNumber || !cardHolder || !cardBank) {
      // Fail closed: never show a stale/wrong hardcoded payment destination
      // if the real one isn't configured for this environment.
      throw new BadRequestException('Payment details are not configured');
    }
    return {
      cardNumber,
      cardHolder,
      cardBank,
      amount: this.config.get('PAYMENT_AMOUNT') || '6.49',
      currency: this.config.get('PAYMENT_CURRENCY') || 'USD',
    };
  }

  async confirmDirectPayment(userId: string, tierName: string, proof: string): Promise<{ success: boolean; message: string; status: string }> {
    const tier = PREMIUM_TIERS.find(t => t.name === tierName);
    if (!tier || tier.tier === 0) {
      throw new BadRequestException('Invalid tier');
    }
    if (!/^\d{4}$/.test(proof)) {
      throw new BadRequestException('proof must be exactly 4 digits');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const existingSub = await this.prisma.premiumSubscription.findUnique({ where: { userId } });
    // `premiumSubscription.status` never flips off 'active' when a subscription
    // naturally lapses (only an explicit refund/dispute/cancel changes it), so
    // trusting it here — like createStripeCheckout's equivalent guard already
    // documents — would permanently block a user from ever submitting a bank
    // transfer renewal again once their premium expires. `user.subscriptionEnd`
    // is the reliable "currently entitled until" signal.
    if (user.subscriptionEnd && user.subscriptionEnd > new Date()) {
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
          `👤 Пользователь: <b>${escapeTelegramHtml(user.displayName || user.email || userId)}</b>\n` +
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
    // Telegram redelivers callbacks on timeout, and the inline keyboard
    // buttons stay clickable after use — a double-tap or a redelivered
    // update could both read status:'pending' before either write commits.
    // Locking the row for the check+write serializes concurrent approvals.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "userId" FROM premium_subscriptions WHERE "userId" = ${userId} FOR UPDATE`;

      const sub = await tx.premiumSubscription.findUnique({ where: { userId } });
      if (!sub || sub.status !== 'pending') {
        return { success: false, message: 'Нет ожидающего платежа' };
      }

      const endDate = (sub.endDate && sub.endDate.getTime() > 0) ? sub.endDate : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await tx.premiumSubscription.update({
        where: { userId },
        data: { status: 'active' },
      });
      await tx.user.update({
        where: { id: userId },
        data: { subscription: sub.levelName, subscriptionEnd: endDate },
      });

      return { success: true, message: `Подписка ${sub.levelName} активирована для пользователя` };
    });
  }

  async rejectPayment(userId: string): Promise<{ success: boolean; message: string }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "userId" FROM premium_subscriptions WHERE "userId" = ${userId} FOR UPDATE`;

      const sub = await tx.premiumSubscription.findUnique({ where: { userId } });
      if (!sub || sub.status !== 'pending') {
        return { success: false, message: 'Нет ожидающего платежа' };
      }

      await tx.premiumSubscription.delete({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: { subscription: 'FREE', subscriptionEnd: null },
      });

      return { success: true, message: `Платёж отклонён, подписка сброшена` };
    });
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
    // Same class of gap as the other paginated services: NaN page/limit
    // (e.g. a non-numeric value) survives Math.max(0, ...) unchanged and
    // would reach Prisma's skip/take as NaN.
    page = Number.isFinite(page) && page > 0 ? page : 1;
    limit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const skip = Math.max(0, (page - 1) * limit);
    const [rows, total] = await Promise.all([
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
          googleId: true,
          passwordHash: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count(),
    ]);
    // passwordHash is only ever selected to derive this boolean — never
    // returned as-is. A caller (Telegram bot today, maybe an admin-panel
    // endpoint tomorrow) that spread/serialized the raw row would otherwise
    // leak bcrypt hashes.
    const users = rows.map(({ passwordHash, ...u }) => ({ ...u, hasPassword: !!passwordHash }));
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
        googleId: true,
        passwordHash: true,
        _count: { select: { reports: true } },
      },
    });
    if (!user) return null;
    const { passwordHash, ...rest } = user;
    return { ...rest, hasPassword: !!passwordHash };
  }

  async deleteUser(userId: string): Promise<{ success: boolean; message: string; email?: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, username: true } });
    if (!user) return { success: false, message: 'Пользователь не найден' };
    try {
      await this.prisma.user.delete({ where: { id: userId } });
      return { success: true, message: 'Удалён', email: user.email };
    } catch (err: any) {
      // Group.ownerId has no onDelete: Cascade — deleting a group owner
      // throws a raw FK violation (P2003) instead of quietly cascading, so
      // an admin doesn't accidentally nuke a real group by deleting its owner.
      if (err?.code === 'P2003') {
        return { success: false, message: 'Нельзя удалить: пользователь владеет группой (сначала передайте владение или удалите группу)' };
      }
      throw err;
    }
  }

  async purgeTestUsers(emailSuffix: string): Promise<{ deleted: string[]; failed: Array<{ email: string; reason: string }> }> {
    const testUsers = await this.prisma.user.findMany({
      where: { email: { endsWith: emailSuffix, mode: 'insensitive' } },
      select: { id: true, email: true },
    });
    const deleted: string[] = [];
    const failed: Array<{ email: string; reason: string }> = [];
    for (const u of testUsers) {
      const result = await this.deleteUser(u.id);
      if (result.success) {
        deleted.push(u.email || u.id);
      } else {
        failed.push({ email: u.email || u.id, reason: result.message });
      }
    }
    return { deleted, failed };
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
    // Previously nulled user.subscription/subscriptionEnd immediately,
    // forfeiting whatever time the user had already paid for (e.g.
    // cancelling on day 1 of a 3-month purchase lost the other ~89 days).
    // Every access check in this file (hasPaidAiAccess, getMySubscription's
    // `active` flag, etc.) already gates on `user.subscriptionEnd > now`, so
    // leaving those fields untouched and only turning off autoRenew lets the
    // user keep access through the period they paid for, exactly like the
    // rest of this file's "keeps access until subscriptionEnd naturally
    // lapses" pattern (refunds/disputes). Only marks the subscription row as
    // cancelled — never claims a match, unlike before it unconditionally
    // nulled the user row even if the subscription row wasn't actually 'active'.
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
      // `sub.status` flips to 'pending' the instant the user starts (even an
      // abandoned) checkout — including while they already have an active
      // paid subscription — since it's one row per userId shared with the
      // in-progress checkout. `user.subscriptionEnd`/`subscription` are only
      // ever written by a confirmed webhook or cancellation, so they're the
      // reliable signal for current entitlement.
      active: !!user?.subscriptionEnd && user.subscriptionEnd > new Date(),
      paymentId: sub?.paymentId,
    };
  }
}
