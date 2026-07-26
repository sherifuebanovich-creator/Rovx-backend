import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import compression from 'compression';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3001);
  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');

  // Profile/group avatars moved to data-URIs stored in the DB (see
  // users.controller.ts / social.controller.ts) so they survive Render's
  // ephemeral filesystem — but that migration only stops *new* uploads from
  // breaking. Any avatar set before it still points at a /uploads/... disk
  // path that's long gone after any subsequent deploy or restart, and would
  // otherwise render as a permanently broken image forever. Clearing those
  // out lets the UI fall back to its default placeholder instead; safe to
  // run on every boot since it's a no-op once nothing matches.
  try {
    const prisma = app.get(PrismaService);
    const [users, groups] = await Promise.all([
      prisma.user.updateMany({ where: { avatar: { startsWith: '/uploads/' } }, data: { avatar: null } }),
      prisma.group.updateMany({ where: { avatar: { startsWith: '/uploads/' } }, data: { avatar: null } }),
    ]);
    if (users.count || groups.count) {
      logger.log(`Cleared ${users.count} stale user avatars and ${groups.count} stale group avatars (pre-migration /uploads/ paths)`);
    }
  } catch (err) {
    logger.warn(`Stale avatar cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Trust proxy (needed for secure cookies behind Render's reverse proxy)
  app.set('trust proxy', 1);

  // Increase body parser limit for photo/video uploads in reports
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });

  // Serve uploaded files
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  // Security
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  }));
  app.use(compression());
  app.use(cookieParser());

  // CORS
  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN', 'http://localhost:3000').split(',').map(s => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-refresh-token'],
  });

  // Global prefix
  app.setGlobalPrefix(apiPrefix);

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global filters & interceptors
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // Swagger
  if (configService.get('NODE_ENV') !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('ROVX API')
      .setDescription('Intelligent Navigation Platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(`Swagger docs: http://localhost:${port}/docs`);
  }

  app.enableShutdownHooks();
  await app.listen(port);
  logger.log(`ROVX Backend running on port ${port}`);
  logger.log(`Environment: ${configService.get('NODE_ENV', 'development')}`);
}

bootstrap();
