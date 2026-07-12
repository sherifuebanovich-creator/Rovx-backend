import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get('REDIS_URL');
    if (redisUrl) {
      this.client = new Redis(redisUrl, {
        retryStrategy: (times) => {
          if (times > 10) {
            this.logger.warn('Redis unavailable — running without cache');
            return null;
          }
          return Math.min(times * 200, 3000);
        },
        lazyConnect: true,
      });
    } else {
      const host = this.configService.get('REDIS_HOST', 'localhost');
      this.client = new Redis({
        host,
        port: this.configService.get<number>('REDIS_PORT', 6379),
        password: this.configService.get('REDIS_PASSWORD'),
        db: this.configService.get<number>('REDIS_DB', 0),
        tls: host !== 'localhost' ? {} : undefined,
        retryStrategy: (times) => {
          if (times > 10) {
            this.logger.warn('Redis unavailable — running without cache');
            return null;
          }
          return Math.min(times * 200, 3000);
        },
        lazyConnect: true,
      });
    }

    this.client.connect().catch(() => {
      this.logger.warn('Redis not available — running without cache');
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connected');
    });
    this.client.on('error', (err) => {
      this.logger.error('Redis error', err.message);
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (e) {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (e) {
      this.logger.debug(`Redis SET ${key} failed: ${(e as Error).message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (e) {
      this.logger.debug(`Redis DEL ${key} failed: ${(e as Error).message}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (e) {
      return false;
    }
  }

  async expire(key: string, seconds: number): Promise<void> {
    try {
      await this.client.expire(key, seconds);
    } catch (e) {
      this.logger.debug(`Redis EXPIRE ${key} failed: ${(e as Error).message}`);
    }
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    try {
      await this.client.hset(key, field, value);
    } catch (e) {
      this.logger.debug(`Redis HSET ${key} failed: ${(e as Error).message}`);
    }
  }

  async hget(key: string, field: string): Promise<string | null> {
    try {
      return await this.client.hget(key, field);
    } catch (e) {
      return null;
    }
  }

  async hdel(key: string, field: string): Promise<void> {
    try {
      await this.client.hdel(key, field);
    } catch (e) {
      this.logger.debug(`Redis HDEL ${key} failed: ${(e as Error).message}`);
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      return await this.client.hgetall(key);
    } catch (e) {
      return {};
    }
  }

  async sadd(key: string, ...members: string[]): Promise<void> {
    try {
      await this.client.sadd(key, ...members);
    } catch (e) {
      this.logger.debug(`Redis SADD ${key} failed: ${(e as Error).message}`);
    }
  }

  async srem(key: string, member: string): Promise<void> {
    try {
      await this.client.srem(key, member);
    } catch (e) {
      this.logger.debug(`Redis SREM ${key} failed: ${(e as Error).message}`);
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      return await this.client.smembers(key);
    } catch (e) {
      return [];
    }
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    try {
      if (keys.length === 0) return [];
      return await this.client.mget(...keys);
    } catch (e) {
      return keys.map(() => null);
    }
  }

  async publish(channel: string, message: string): Promise<void> {
    try {
      await this.client.publish(channel, message);
    } catch (e) {
      this.logger.debug(`Redis PUBLISH ${channel} failed: ${(e as Error).message}`);
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (e) {
      return 0;
    }
  }

  async setnx(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    try {
      const result = await this.client.setnx(key, value);
      if (result && ttlSeconds) {
        await this.client.expire(key, ttlSeconds);
      }
      return result === 1;
    } catch (e) {
      return false;
    }
  }

  getClient(): Redis {
    return this.client;
  }
}
