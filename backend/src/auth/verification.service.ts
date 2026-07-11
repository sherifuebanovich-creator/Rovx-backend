import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { randomInt, timingSafeEqual } from 'crypto';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(private redis: RedisService) {}

  async generateCode(email: string): Promise<string> {
    const blocked = await this.redis.exists(`verify:blocked:${email}`);
    if (blocked) {
      throw new Error('Too many attempts. Try again in 30 minutes.');
    }

    const code = randomInt(100000, 999999).toString();
    await this.redis.set(`verify:code:${email}`, code, 600);
    this.logger.log(`Verification code generated for ${email}`);
    return code;
  }

  async verifyCode(email: string, code: string): Promise<boolean> {
    if (await this.redis.exists(`verify:blocked:${email}`)) {
      return false;
    }

    const storedCode = await this.redis.get(`verify:code:${email}`);
    if (!storedCode) {
      return false;
    }

    const a = Buffer.from(storedCode);
    const b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      await this.redis.del(`verify:code:${email}`);
      await this.redis.del(`verify:attempts:${email}`);
      return true;
    }

    const attempts = await this.redis.incr(`verify:attempts:${email}`);
    if (attempts === 1) {
      await this.redis.expire(`verify:attempts:${email}`, 600);
    }

    if (attempts >= 3) {
      await this.redis.set(`verify:blocked:${email}`, 'true', 1800);
      await this.redis.del(`verify:attempts:${email}`);
      await this.redis.del(`verify:code:${email}`);
      this.logger.warn(`Verification blocked for ${email} after 3 failed attempts`);
    }

    return false;
  }
}
