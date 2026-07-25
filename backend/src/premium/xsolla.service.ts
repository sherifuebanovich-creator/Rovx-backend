import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

interface XsollaCreateTokenParams {
  userId: string;
  email: string;
  userName: string;
  tierName: string;
  tierPrice: number;
  months: number;
  language?: string;
}

@Injectable()
export class XsollaService {
  private readonly logger = new Logger(XsollaService.name);

  private get merchantId() { return this.config.get<number>('XSOLLA_MERCHANT_ID'); }
  private get apiKey() { return this.config.get<string>('XSOLLA_API_KEY'); }
  private get projectId() { return this.config.get<number>('XSOLLA_PROJECT_ID'); }
  private get webhookSecret() { return this.config.get<string>('XSOLLA_WEBHOOK_SECRET'); }
  private get isSandbox() { return this.config.get<string>('XSOLLA_MODE', 'sandbox') === 'sandbox'; }
  private get appUrl() { return this.config.get<string>('APP_URL', 'https://rovx-app-livid.vercel.app'); }

  constructor(private config: ConfigService) {}

  get configured(): boolean {
    return !!(this.merchantId && this.apiKey && this.projectId);
  }

  async createPaymentToken(params: XsollaCreateTokenParams): Promise<{ token: string; url: string }> {
    const { userId, email, userName, tierName, tierPrice, months, language } = params;
    const amount = +(tierPrice * months).toFixed(2);

    const body: any = {
      user: {
        id: { value: userId },
        email: { value: email },
        name: { value: userName },
      },
      settings: {
        project_id: Number(this.projectId),
        currency: 'USD',
        language: language || 'en',
        mode: this.isSandbox ? 'sandbox' : 'production',
        ui: { theme: 'dark' },
        return_url: `${this.appUrl}/premium`,
      },
      purchase: {
        checkout: { amount, currency: 'USD' },
        description: { value: `${tierName} - ${months} month(s)` },
      },
      custom_parameters: {
        tier_name: tierName,
        months: String(months),
      },
    };

    try {
      const res = await axios.post(
        `https://api.xsolla.com/merchant/v2/merchants/${this.merchantId}/token`,
        body,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.merchantId}:${this.apiKey}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        },
      );

      const token = res.data.token as string;
      const domain = this.isSandbox ? 'sandbox-secure.xsolla.com' : 'secure.xsolla.com';
      return {
        token,
        url: `https://${domain}/paystation3/?token=${token}`,
      };
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      this.logger.error(`Xsolla create token failed: ${detail}`);
      throw new BadRequestException('Payment initiation failed. Please try again.');
    }
  }

  verifyWebhookSignature(rawBody: string, authHeader: string): boolean {
    if (!this.webhookSecret || !authHeader) {
      this.logger.error('Xsolla webhook verification FAILED — missing secret or header (rejecting)');
      return false;
    }

    // Xsolla's real webhook header is `Authorization: Signature <hash>` —
    // two parts, not three — where <hash> is plain SHA1(raw_body +
    // secret_key), NOT a keyed HMAC. The previous implementation required
    // a 3-part "Signature <algorithm> <hash>" header and computed an HMAC,
    // neither of which a genuine Xsolla request ever sends: the length
    // check alone rejected every real webhook regardless of hash scheme,
    // so no Xsolla payment could ever be credited in production.
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Signature') {
      this.logger.warn(`Invalid Xsolla auth header format: ${authHeader}`);
      return false;
    }

    const signature = parts[1];

    try {
      const hash = crypto.createHash('sha1').update(rawBody + this.webhookSecret).digest('hex');
      const tokenBuf = Buffer.from(hash, 'hex');
      const sigBuf = Buffer.from(signature, 'hex');
      if (tokenBuf.length !== sigBuf.length) {
        this.logger.warn('Xsolla webhook signature length mismatch');
        return false;
      }
      return crypto.timingSafeEqual(tokenBuf, sigBuf);
    } catch {
      return false;
    }
  }
}
