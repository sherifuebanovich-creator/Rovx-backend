import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class PaymeService {
  private readonly logger = new Logger(PaymeService.name);
  private readonly merchantId: string;
  private readonly merchantKey: string;
  private readonly apiUrl = 'https://payme.uz';

  constructor(private config: ConfigService) {
    this.merchantId = this.config.get('PAYME_MERCHANT_ID', '');
    this.merchantKey = this.config.get('PAYME_MERCHANT_KEY', '');
  }

  get configured(): boolean {
    return !!(this.merchantId && this.merchantKey);
  }

  private generateAuthHeader(method: string, params: any): string {
    const jsonRpcRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    };

    const requestString = JSON.stringify(jsonRpcRequest);
    const hash = crypto.createHash('md5').update(requestString).digest('hex');

    return `Basic ${Buffer.from(`${this.merchantId}:${hash}`).toString('base64')}`;
  }

  async createReceipt(params: {
    amount: number;
    description: string;
    userId: string;
    tierName: string;
  }): Promise<{ receiptId: string; paymentUrl: string }> {
    if (!this.configured) {
      throw new Error('Payme not configured');
    }

    const amountInTiyin = params.amount * 100; // Convert to tiyin (1 UZS = 100 tiyin)

    const requestBody = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'Receipts.Create',
      params: {
        amount: amountInTiyin,
        description: params.description,
        account: {
          user_id: params.userId,
          tier_name: params.tierName,
        },
      },
    };

    try {
      const response = await axios.post(this.apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.generateAuthHeader('Receipts.Create', requestBody.params),
        },
        timeout: 15000,
      });

      const data = response.data;

      if (data.result) {
        const receiptId = data.result.receipt._id;
        this.logger.log(`Payme receipt created: ${receiptId}`);

        // Generate payment URL
        const paymentUrl = `https://payme.uz/pay/${receiptId}`;

        return { receiptId, paymentUrl };
      } else {
        this.logger.error(`Payme error: ${JSON.stringify(data.error)}`);
        throw new Error(data.error?.message || 'Receipt creation failed');
      }
    } catch (error) {
      this.logger.error(`Payme request failed: ${error.message}`);
      throw error;
    }
  }

  async checkReceiptStatus(receiptId: string): Promise<any> {
    if (!this.configured) throw new Error('Payme not configured');

    const requestBody = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'Receipts.Get',
      params: { id: receiptId },
    };

    const response = await axios.post(this.apiUrl, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.generateAuthHeader('Receipts.Get', requestBody.params),
      },
      timeout: 15000,
    });

    return response.data;
  }

  verifyWebhook(body: any): boolean {
    if (!this.configured) return false;

    try {
      // Payme sends webhook with method and params
      if (!body?.method || !body?.params) return false;

      const { method, params } = body;

      // Verify the webhook is from Payme by checking the method
      if (method === 'Receipts.Pay') {
        return !!(params.receipt_id && params.payment);
      }

      return false;
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: any): {
    event: string;
    receiptId: string;
    status: string;
    userId?: string;
    tierName?: string;
    amount?: number;
  } | null {
    try {
      const { method, params } = body;

      if (method === 'Receipts.Pay') {
        const receipt = params.receipt || {};
        const account = receipt.account || {};

        return {
          event: 'payment_success',
          receiptId: params.receipt_id || receipt._id || '',
          status: receipt.state?.status || 'paid',
          userId: account.user_id,
          tierName: account.tier_name,
          amount: receipt.amount || 0,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  async cancelReceipt(receiptId: string, reason: string): Promise<boolean> {
    if (!this.configured) throw new Error('Payme not configured');

    const requestBody = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'Receipts.Cancel',
      params: {
        id: receiptId,
        reason,
      },
    };

    try {
      const response = await axios.post(this.apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.generateAuthHeader('Receipts.Cancel', requestBody.params),
        },
        timeout: 15000,
      });

      return !!response.data.result;
    } catch (error) {
      this.logger.error(`Payme cancel failed: ${error.message}`);
      return false;
    }
  }
}
