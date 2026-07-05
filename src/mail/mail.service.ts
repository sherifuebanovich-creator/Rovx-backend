import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    const user = this.configService.get('SMTP_USER');
    const pass = this.configService.get('SMTP_PASS');

    if (!user || !pass) {
      this.logger.warn('SMTP not configured. Email sending will fail.');
    }

    this.transporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST', 'smtp.gmail.com'),
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: false,
      auth: { user, pass },
    });
  }

  async sendVerificationCode(to: string, code: string): Promise<void> {
    const from =
      this.configService.get('MAIL_FROM') || this.configService.get('SMTP_USER');

    await this.transporter.sendMail({
      from,
      to,
      subject: 'Подтверждение email — ROVX',
      html: this.buildVerificationEmail(code),
    });

    this.logger.log(`Verification code sent to ${to}`);
  }

  private buildVerificationEmail(code: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Подтверждение email</h2>
        <p>Ваш код подтверждения:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; background: #f5f5f5; border-radius: 8px;">
          ${code}
        </div>
        <p style="color: #666;">Код действителен в течение 10 минут.</p>
        <hr style="border: none; border-top: 1px solid #eee;" />
        <p style="color: #999; font-size: 12px;">Если вы не запрашивали этот код, проигнорируйте это письмо.</p>
      </div>
    `;
  }
}
