import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class YooKassaService {
  private readonly logger = new Logger(YooKassaService.name);
  private readonly shopId: string;
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.yookassa.ru/v3';

  constructor(private config: ConfigService) {
    this.shopId = this.config.get('YOOKASSA_SHOP_ID', '');
    this.secretKey = this.config.get('YOOKASSA_SECRET_KEY', '');
  }

  get configured(): boolean {
    return !!(this.shopId && this.secretKey);
  }

  private get auth(): string {
    return 'Basic ' + Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64');
  }

  async createPayment(params: {
    amount: number;
    currency: string;
    description: string;
    userId: string;
    tierName: string;
    returnUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ paymentId: string; confirmationUrl: string }> {
    if (!this.configured) {
      throw new Error('YooKassa not configured');
    }

    const idempotenceKey = crypto.randomUUID();

    const response = await axios.post(
      `${this.baseUrl}/payments`,
      {
        amount: {
          value: params.amount.toFixed(2),
          currency: params.currency,
        },
        confirmation: {
          type: 'redirect',
          return_url: params.returnUrl,
        },
        capture: true,
        description: params.description,
        metadata: {
          userId: params.userId,
          tierName: params.tierName,
          ...params.metadata,
        },
      },
      {
        headers: {
          Authorization: this.auth,
          'Content-Type': 'application/json',
          'Idempotence-Key': idempotenceKey,
        },
        timeout: 15000,
      },
    );

    const payment = response.data;
    this.logger.log(`YooKassa payment created: ${payment.id}`);

    return {
      paymentId: payment.id,
      confirmationUrl: payment.confirmation?.confirmation_url || '',
    };
  }

  verifyWebhook(body: any, signatureHeader: string): boolean {
    if (!this.configured) return false;

    try {
      const rawBody = JSON.stringify(body);
      const signature = crypto
        .createHmac('sha256', this.secretKey)
        .update(rawBody)
        .digest('base64');

      return signature === signatureHeader;
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: any): {
    event: string;
    paymentId: string;
    status: string;
    userId?: string;
    tierName?: string;
    amount?: number;
    currency?: string;
  } | null {
    try {
      const event = body.event;
      const payment = body.object;

      if (!event || !payment) return null;

      return {
        event,
        paymentId: payment.id,
        status: payment.status,
        userId: payment.metadata?.userId,
        tierName: payment.metadata?.tierName,
        amount: parseFloat(payment.amount?.value || '0'),
        currency: payment.amount?.currency,
      };
    } catch {
      return null;
    }
  }
}
