const { NestFactory } = require('@nestjs/core');
const { ExpressAdapter } = require('@nestjs/platform-express');
const { ValidationPipe } = require('@nestjs/common');
const { ConfigService } = require('@nestjs/config');
const compression = require('compression');
const helmet = require('helmet');
const express = require('express');
const serverlessExpress = require('@codegenie/serverless-express');
const { AppModule } = require('../dist/app.module');
const { HttpExceptionFilter } = require('../dist/common/filters/http-exception.filter');
const { TransformInterceptor } = require('../dist/common/interceptors/transform.interceptor');
const { LoggingInterceptor } = require('../dist/common/interceptors/logging.interceptor');

let cachedHandler;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(), {
    rawBody: true,
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const configService = app.get(ConfigService);
  const apiPrefix = configService.get('API_PREFIX', 'api/v1');

  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });

  app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));
  app.use(compression());

  app.enableCors({
    origin: configService.get('CORS_ORIGIN', 'http://localhost:3000').split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-refresh-token'],
  });

  app.setGlobalPrefix(apiPrefix);
  app.use(`/${apiPrefix}/premium/webhook`, express.raw({ type: 'application/json' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  await app.init();
  return app;
}

module.exports = async (req, res) => {
  if (!cachedHandler) {
    const app = await bootstrap();
    cachedHandler = serverlessExpress({ app: app.getHttpAdapter().getInstance() });
  }
  return cachedHandler(req, res);
};
