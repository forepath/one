import { createOriginAllowlistMiddleware } from '@forepath/identity/backend/util-auth/core';
import {
  CorrelationAwareConsoleLogger,
  createCorrelationIdMiddleware,
  registerAxiosCorrelationIdPropagation,
} from '@forepath/shared/backend/util-http-context';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import axios from 'axios';

import { AppModule } from './app/app.module';

function assertProductionConfigOrExit(logger: Logger): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const required = [
    'CHATWOOT_BASE_URL',
    'CHATWOOT_API_ACCESS_TOKEN',
    'CHATWOOT_ACCOUNT_ID',
    'CHATWOOT_INBOX_ID',
    'CLOUDFLARE_TURNSTILE_SECRET_KEY',
    'CORS_ORIGIN',
  ];

  const missing = required.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    logger.error(`Missing required production environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

export async function bootstrap(): Promise<void> {
  const appLogger = new CorrelationAwareConsoleLogger({ json: true, colors: false });

  Logger.overrideLogger(appLogger);
  registerAxiosCorrelationIdPropagation(axios);

  assertProductionConfigOrExit(new Logger('ProductionConfig'));

  const app = await NestFactory.create(AppModule, { logger: appLogger });
  const httpLogger = new Logger('HTTP');

  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigin = process.env.CORS_ORIGIN;
  let origin: string | string[];

  if (corsOrigin) {
    origin = corsOrigin.split(',').map((value) => value.trim());
  } else if (isProduction) {
    origin = [];
    Logger.warn('CORS_ORIGIN not set in production - CORS is disabled. Set CORS_ORIGIN to allow specific origins.');
  } else {
    origin = '*';
  }

  app.enableCors({
    origin,
    credentials: origin !== '*' && Array.isArray(origin) && origin.length > 0,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id', 'X-Request-Id'],
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'X-Correlation-Id'],
  });

  app.use(
    createCorrelationIdMiddleware({
      log: (message: string) => httpLogger.log(message),
    }),
  );
  app.use(createOriginAllowlistMiddleware(new Logger('OriginAllowlist')));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  const port = parseInt(process.env.PORT || '3300', 10);

  await app.listen(port);
  Logger.log(`Communication API is running on: http://localhost:${port}/api`);
}
