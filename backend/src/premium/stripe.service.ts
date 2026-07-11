import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe | null = null;
  readonly configured: boolean;

  constructor(private config: ConfigService) {
    const secretKey = this.config.get('STRIPE_SECRET_KEY') || '';
    if (secretKey) {
      this.stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' as any });
      this.configured = true;
      this.logger.log('Stripe payment integration configured');
    } else {
      this.configured = false;
    }
  }

  async createCheckoutSession(params: {
    email: string;
    tierName: string;
    tierLabel: string;
    amount: number;
    currency: string;
    userId: string;
  }): Promise<{ url: string; sessionId: string }> {
    if (!this.configured || !this.stripe) {
      throw new BadRequestException('Stripe is not configured');
    }

    const frontendUrl = this.config.get('FRONTEND_URL') || 'https://rovx-app-livid.vercel.app';

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: params.email,
      line_items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            product_data: {
              name: `ROVX ${params.tierLabel}`,
              description: `Premium subscription - 30 days`,
            },
            unit_amount: Math.round(params.amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${frontendUrl}/premium?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/premium?canceled=true`,
      metadata: {
        userId: params.userId,
        tierName: params.tierName,
      },
    });

    this.logger.log(`Stripe checkout created: ${session.id} for user ${params.userId}`);
    return { url: session.url!, sessionId: session.id };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): Stripe.Event | null {
    if (!this.configured || !this.stripe) return null;

    const webhookSecret = this.config.get('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) return null;

    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      this.logger.error(`Stripe webhook signature verification failed: ${err}`);
      return null;
    }
  }
}
