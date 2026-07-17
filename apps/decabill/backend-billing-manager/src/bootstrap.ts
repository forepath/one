import {
  CorrelationAwareConsoleLogger,
  createCorrelationIdMiddleware,
  createTenantIdMiddleware,
  registerAxiosCorrelationIdPropagation,
  TenantAwareSocketIoAdapter,
} from '@forepath/shared/backend/util-http-context';
import { createOriginAllowlistMiddleware } from '@forepath/identity/backend';
import { assertProductionEncryptionKeyOrExit } from '@forepath/shared/backend';
import { assertProductionWebhookEscapeHatchesDisabled } from '@forepath/shared/backend/util-webhook';
import {
  assertBullBoardAuthConfigured,
  getBullBoardGlobalPrefixExcludes,
  getQueueRole,
  readBullBoardAuthConfig,
  readBullBoardPath,
  shouldEnableBullBoard,
  runPendingMigrationsIfRoleAllows,
  shouldRunApiHttp,
} from '@forepath/shared/backend';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import axios from 'axios';
import * as express from 'express';

import { AppModule } from './app/app.module';
import { typeormConfig } from './typeorm.config';

export async function bootstrap(): Promise<void> {
  assertProductionEncryptionKeyOrExit(new Logger('EncryptionKey'));
  assertProductionWebhookEscapeHatchesDisabled(new Logger('WebhookSafety'));

  const appLogger = new CorrelationAwareConsoleLogger({ json: true, colors: false });

  Logger.overrideLogger(appLogger);
  registerAxiosCorrelationIdPropagation(axios);

  const role = getQueueRole();

  assertBullBoardAuthConfigured(appLogger);

  const runHttp = shouldRunApiHttp(role) || shouldEnableBullBoard(role);

  if (!runHttp) {
    const context = await NestFactory.createApplicationContext(AppModule, { logger: appLogger });

    Logger.log(`Billing queue process started (QUEUE_ROLE=${role})`);
    await context.init();

    return;
  }

  const app = await NestFactory.create(AppModule, { logger: appLogger, rawBody: true });
  const httpLogger = new Logger('HTTP');

  app.use('/api/webhooks/payments/stripe', express.raw({ type: 'application/json' }), (req, _res, next) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = req.body as Buffer;
    next();
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigin = process.env.CORS_ORIGIN;
  let origin: string | string[];

  if (corsOrigin) {
    origin = corsOrigin.split(',').map((value) => value.trim());
  } else if (isProduction) {
    origin = [];
    Logger.warn('⚠️  CORS_ORIGIN not set in production - CORS is disabled. Set CORS_ORIGIN to allow specific origins.');
  } else {
    origin = '*';
  }

  app.enableCors({
    origin,
    credentials: origin !== '*' && Array.isArray(origin) && origin.length > 0,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id', 'X-Request-Id', 'X-Tenant'],
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'X-Correlation-Id'],
  });

  app.use(
    createCorrelationIdMiddleware({
      log: (message: string) => httpLogger.log(message),
    }),
  );
  app.use(createTenantIdMiddleware());
  app.use(createOriginAllowlistMiddleware(new Logger('OriginAllowlist')));
  app.useWebSocketAdapter(new TenantAwareSocketIoAdapter(app));

  await runPendingMigrationsIfRoleAllows(app, role, typeormConfig);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const globalPrefix = 'api';
  const bullBoardExcludes = getBullBoardGlobalPrefixExcludes();

  app.setGlobalPrefix(globalPrefix, bullBoardExcludes.length > 0 ? { exclude: bullBoardExcludes } : undefined);
  const port = parseInt(process.env.PORT || '3200', 10);

  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${port}/${globalPrefix} (QUEUE_ROLE=${role})`);

  if (shouldEnableBullBoard(role)) {
    const { username } = readBullBoardAuthConfig();

    Logger.log(`📊 Bull Board: http://localhost:${port}${readBullBoardPath()} (HTTP Basic, user ${username})`);
  }
}
