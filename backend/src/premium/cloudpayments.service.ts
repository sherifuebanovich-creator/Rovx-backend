import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class CloudPaymentsService {
  private readonly logger = new Logger(CloudPaymentsService.name);
  private readonly publicId: string;
  private readonly apiSecret: string;
  private readonly baseUrl = 'https://api.cloudpayments.ru';

  constructor(private config: ConfigService) {
    this.publicId = this.config.get('CLOUDPAYMENTS_PUBLIC_ID', '');
    this.apiSecret = this.config.get('CLOUDPAYMENTS_API_SECRET', '');
  }

  get configured(): boolean {
    return !!(this.publicId && this.apiSecret);
  }

  private get auth(): string {
    return 'Basic ' + Buffer.from(`${this.publicId}:${this.apiSecret}`).toString('base64');
  }

  async createPayment(params: {
    amount: number;
    currency: string;
    description: string;
    userId: string;
    tierName: string;
    email?: string;
    returnUrl: string;
  }): Promise<{ paymentId: string; confirmationUrl: string }> {
    if (!this.configured) {
      throw new Error('CloudPayments not configured');
    }

    const response = await axios.post(
      `${this.baseUrl}/payments/cards`,
      {
        Amount: params.amount,
        Currency: params.currency,
        Description: params.description,
        Email: params.email || '',
        RequireConfirmation: false,
        SendEmail: false,
        Metadata: {
          userId: params.userId,
          tierName: params.tierName,
        },
      },
      {
        headers: {
          Authorization: this.auth,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
    );

    const data = response.data;
    if (!data.success) {
      this.logger.error(`CloudPayments create failed: ${JSON.stringify(data)}`);
      throw new Error(data.message || 'Payment creation failed');
    }

    const paymentId = data.model?.transaction?.Id?.toString() || data.model?.id || '';
    const confirmationUrl = data.model?.model?.cardHolderActionUrl
      || data.model?.cardPayUrl
      || '';

    this.logger.log(`CloudPayments payment created: ${paymentId}`);

    return { paymentId, confirmationUrl };
  }

  verifyWebhook(body: any, signatureHeader: string): boolean {
    if (!this.configured) return false;

    try {
      const rawBody = JSON.stringify(body);
      const hash = crypto
        .createHmac('sha256', this.apiSecret)
        .update(rawBody)
        .digest('base64');

      return hash === signatureHeader;
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
      const transaction = body.model?.transaction || body.model;

      if (!event || !transaction) return null;

      const metadata = transaction.metadata || {};
      const status = transaction.status || transaction.resultCode || '';

      return {
        event,
        paymentId: transaction.id?.toString() || '',
        status,
        userId: metadata.userId,
        tierName: metadata.tierName,
        amount: transaction.amount || 0,
        currency: transaction.currency || 'RUB',
      };
    } catch {
      return null;
    }
  }
}
