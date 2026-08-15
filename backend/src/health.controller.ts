import { Controller, Get, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { MailService } from './mail/mail.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private mail: MailService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Check API and services health' })
  async health() {
    let dbStatus = 'ok';
    let redisStatus = 'ok';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      this.logger.error('Health Check: Database DOWN', e instanceof Error ? e.message : String(e));
      dbStatus = 'down';
    }

    try {
      await this.redis.ping();
    } catch (e) {
      this.logger.error('Health Check: Redis DOWN', e instanceof Error ? e.message : String(e));
      redisStatus = 'down';
    }

    // Not part of `isHealthy` — SMTP being unconfigured shouldn't flip the
    // healthcheck to 503 and send Render into a restart loop over something
    // that isn't a crash. It's exposed here purely as a no-secrets-leaked
    // way to see whether SMTP_USER/SMTP_PASS are actually set on Render,
    // since that env var panel isn't otherwise reachable from outside the
    // dashboard.
    const mailStatus = this.mail.isConfigured() ? 'configured' : 'not_configured';

    const isHealthy = dbStatus === 'ok' && redisStatus === 'ok';
    const status = isHealthy ? 'ok' : 'degraded';

    if (!isHealthy) {
      throw new HttpException({
        status,
        version: '1.0.0',
        app: 'ROVX API',
        timestamp: new Date().toISOString(),
        services: { database: dbStatus, redis: redisStatus, mail: mailStatus },
      }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status,
      version: '1.0.0',
      app: 'ROVX API',
      timestamp: new Date().toISOString(),
      services: { database: dbStatus, redis: redisStatus, mail: mailStatus },
    };
  }
}
