import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class LavaTopService {
  private readonly logger = new Logger(LavaTopService.name);
  readonly configured: boolean;
  private apiKey: string;
  private webhookKey: string;
  private apiUrl = 'https://gate.lava.top';

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get('LAVA_TOP_API_KEY') || '';
    this.webhookKey = this.config.get('LAVA_TOP_WEBHOOK_KEY') || '';
    this.configured = !!this.apiKey;
    if (this.configured) {
      this.logger.log('Lava.top payment integration configured');
    }
  }

  private headers() {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey,
    };
  }

  async createInvoice(params: {
    email: string;
    offerId: string;
    amount: number;
    currency: string;
  }): Promise<{ invoiceUrl: string; invoiceId: string }> {
    if (!this.configured) {
      throw new BadRequestException('Lava.top payment is not configured');
    }

    const res = await fetch(`${this.apiUrl}/api/v3/invoice`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        email: params.email,
        offerId: params.offerId,
        amount: params.amount,
        currency: params.currency,
      }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      this.logger.error(`Lava.top invoice creation failed: ${JSON.stringify(data)}`);
      throw new BadRequestException(data.error?.message || 'Failed to create invoice');
    }

    const invoice = data.data || data;
    return {
      invoiceUrl: invoice.paymentUrl || invoice.url || invoice.invoiceUrl,
      invoiceId: invoice.id || invoice.invoiceId,
    };
  }

  verifyWebhookSignature(body: any, receivedSignature: string): boolean {
    if (!this.webhookKey) {
      this.logger.warn('LAVA_TOP_WEBHOOK_KEY not configured — rejecting webhook');
      return false;
    }

    const sortedKeys = Object.keys(body).sort();
    const signString = sortedKeys
      .filter(k => k !== 'signature')
      .map(k => `${k}=${typeof body[k] === 'object' ? JSON.stringify(body[k]) : body[k]}`)
      .join('&');

    const expected = crypto
      .createHmac('sha256', this.webhookKey)
      .update(signString)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(receivedSignature, 'hex');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  }
}
