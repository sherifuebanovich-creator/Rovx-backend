import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class LemonSqueezyService {
  private readonly logger = new Logger(LemonSqueezyService.name);
  readonly configured: boolean;
  private apiKey: string;
  private storeId: string;
  private variantId: string;
  private webhookSecret: string;
  private apiUrl = 'https://api.lemonsqueezy.com/v1';

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get('LEMON_SQUEEZY_API_KEY') || '';
    this.storeId = this.config.get('LEMON_SQUEEZY_STORE_ID') || '';
    this.variantId = this.config.get('LEMON_SQUEEZY_VARIANT_ID') || '';
    this.webhookSecret = this.config.get('LEMON_SQUEEZY_WEBHOOK_SECRET') || '';
    this.configured = !!this.apiKey && !!this.storeId && !!this.variantId;
    if (this.configured) {
      this.logger.log('Lemon Squeezy payment integration configured');
    }
  }

  private headers() {
    return {
      'Accept': 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  async createCheckout(params: {
    email: string;
    userId: string;
    amount: number;
    productName: string;
    redirectUrl?: string;
  }): Promise<{ checkoutUrl: string; checkoutId: string }> {
    if (!this.configured) {
      throw new BadRequestException('Lemon Squeezy payment is not configured');
    }

    const res = await fetch(`${this.apiUrl}/checkouts`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            custom_price: params.amount,
            product_options: {
              redirect_url: params.redirectUrl || 'https://rovx-app-livid.vercel.app/premium/success',
            },
            checkout_data: {
              email: params.email,
              custom: {
                user_id: params.userId,
              },
            },
          },
          relationships: {
            store: {
              data: { type: 'stores', id: this.storeId },
            },
            variant: {
              data: { type: 'variants', id: this.variantId },
            },
          },
        },
      }),
    });

    const data = await res.json();

    if (!res.ok || data.errors) {
      this.logger.error(`Lemon Squeezy checkout failed: ${JSON.stringify(data)}`);
      throw new BadRequestException(data.errors?.[0]?.detail || 'Failed to create checkout');
    }

    return {
      checkoutUrl: data.data.attributes.url,
      checkoutId: data.data.id,
    };
  }

  verifyWebhookSignature(body: string, signature: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('LEMON_SQUEEZY_WEBHOOK_SECRET not configured — rejecting webhook');
      return false;
    }

    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(body)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const sigBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, sigBuf);
  }
}
