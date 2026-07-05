import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
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

    const isHealthy = dbStatus === 'ok' && redisStatus === 'ok';
    const status = isHealthy ? 'ok' : 'degraded';

    const healthResponse = {
      status,
      version: '1.0.0',
      app: 'ROVX API',
      timestamp: new Date().toISOString(),
      services: { database: dbStatus, redis: redisStatus },
    };

    return healthResponse;
  }
}
