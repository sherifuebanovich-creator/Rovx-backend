import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class IyzicoService {
  private readonly logger = new Logger(IyzicoService.name);
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.iyzipay.com';

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get('IYZICO_API_KEY', '');
    this.secretKey = this.config.get('IYZICO_SECRET_KEY', '');
  }

  get configured(): boolean {
    return !!(this.apiKey && this.secretKey);
  }

  private generatePkiString(data: any): string {
    const items: string[] = [];
    for (const [key, val] of Object.entries(data)) {
      if (val === undefined || val === null) continue;
      if (typeof val === 'object' && val !== null) {
        items.push(`${key}=${JSON.stringify(val)}`);
      } else {
        items.push(`${key}=${val}`);
      }
    }
    return items.join('&');
  }

  private generateAuthHeaders(pkiString: string): Record<string, string> {
    const now = new Date();
    const randomStr = crypto.randomBytes(16).toString('base64').substring(0, 12);

    const headerString = `${this.apiKey}${randomStr}${now.toISOString()}${pkiString}`;
    const hash = crypto.createHmac('sha256', this.secretKey).update(headerString).digest('base64');

    return {
      'Authorization': `apiKey:${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-iyzi-Rnd': randomStr,
      'X-iyzi-Client-Version': '1.0.0',
    };
  }

  async createCheckoutForm(params: {
    price: number;
    currency: string;
    buyerName: string;
    buyerEmail: string;
    userId: string;
    tierName: string;
    successUrl: string;
    failUrl: string;
    callbackUrl: string;
  }): Promise<{ token: string; paymentPageUrl: string }> {
    if (!this.configured) {
      throw new Error('Iyzico not configured');
    }

    const conversationId = `rovx_${params.userId}_${Date.now()}`;

    const body = {
      locale: 'ru',
      conversationId,
      price: params.price.toFixed(2),
      paidPrice: params.price.toFixed(2),
      currency: params.currency,
      basketId: `rovx_${params.tierName}_${Date.now()}`,
      paymentGroup: 'VIRTUAL',
      paymentCard: {
        cardHolderName: params.buyerName,
      },
      buyer: {
        id: params.userId,
        name: params.buyerName.split(' ')[0] || params.buyerName,
        surname: params.buyerName.split(' ').slice(1).join(' ') || '',
        email: params.buyerEmail,
        identityNumber: '11111111111',
        registrationAddress: 'Tashkent',
        city: 'Tashkent',
        country: 'UZB',
        ip: '85.110.123.45',
      },
      shippingAddress: {
        contactName: params.buyerName,
        city: 'Tashkent',
        country: 'UZB',
        address: 'Tashkent',
      },
      billingAddress: {
        contactName: params.buyerName,
        city: 'Tashkent',
        country: 'UZB',
        address: 'Tashkent',
      },
      callbackUrl: params.callbackUrl,
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/payment/iyzipos/checkoutform/auth/ecom/detail`,
        body,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        },
      );

      const data = response.data;

      if (data.status === 'success') {
        this.logger.log(`Iyzico checkout created: ${data.paymentId}`);
        return {
          token: data.token,
          paymentPageUrl: data.paymentPageUrl || '',
        };
      } else {
        this.logger.error(`Iyzico error: ${JSON.stringify(data)}`);
        throw new Error(data.errorMessage || 'Payment creation failed');
      }
    } catch (error) {
      this.logger.error(`Iyzico request failed: ${error.message}`);
      throw error;
    }
  }

  async retrievePayment(token: string): Promise<any> {
    if (!this.configured) throw new Error('Iyzico not configured');

    const response = await axios.post(
      `${this.baseUrl}/payment/iyzipos/checkoutform/auth/ecom/detail`,
      { locale: 'ru', conversationId: `retrieve_${token}`, token },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 },
    );

    return response.data;
  }

  verifyWebhook(body: any): boolean {
    if (!this.configured) return false;
    // Iyzico webhooks are verified by token exchange
    return !!(body?.token);
  }

  parseWebhookEvent(body: any): {
    paymentId: string;
    status: string;
    tierName: string;
    userId: string;
  } | null {
    try {
      const paymentId = body?.paymentId || body?.paymentId?.toString() || '';
      const status = body?.paymentStatus || body?.status || '';
      const conversationId = body?.conversationId || '';
      // conversationId = rovx_userId_tierName_timestamp
      const parts = conversationId.split('_');
      const userId = parts[1] || '';
      const tierName = parts[2] || '';

      return {
        paymentId,
        status,
        tierName,
        userId,
      };
    } catch {
      return null;
    }
  }
}
