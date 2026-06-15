import { assertProductionClientEndpointAllowlistConfigured } from '@forepath/agenstra/backend/feature-agent-controller';
import {
  CorrelationAwareConsoleLogger,
  CorrelationAwareSocketIoAdapter,
  createCorrelationIdMiddleware,
  registerAxiosCorrelationIdPropagation,
} from '@forepath/shared/backend/util-http-context';
import { createOriginAllowlistMiddleware } from '@forepath/identity/backend';
import { assertProductionEncryptionKeyOrExit } from '@forepath/shared/backend';
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

import { AppModule } from './app/app.module';
import { typeormConfig } from './typeorm.config';

export async function bootstrap(): Promise<void> {
  assertProductionEncryptionKeyOrExit(new Logger('EncryptionKey'));
  assertProductionClientEndpointAllowlistConfigured(new Logger('ClientEndpointAllowlist'));

  const appLogger = new CorrelationAwareConsoleLogger({ json: true, colors: false });

  Logger.overrideLogger(appLogger);
  registerAxiosCorrelationIdPropagation(axios);

  const role = getQueueRole();

  assertBullBoardAuthConfigured(appLogger);

  const runHttp = shouldRunApiHttp(role) || shouldEnableBullBoard(role);

  if (!runHttp) {
    const context = await NestFactory.createApplicationContext(AppModule, { logger: appLogger });

    Logger.log(`Agent controller queue process started (QUEUE_ROLE=${role})`);
    await context.init();

    return;
  }

  const app = await NestFactory.create(AppModule, { logger: appLogger });
  const httpLogger = new Logger('HTTP');

  app.use(
    createCorrelationIdMiddleware({
      log: (message: string) => httpLogger.log(message),
    }),
  );
  app.use(createOriginAllowlistMiddleware(new Logger('OriginAllowlist')));
  app.useWebSocketAdapter(new CorrelationAwareSocketIoAdapter(app));

  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigin = process.env.CORS_ORIGIN;
  let origin: string | string[];

  if (corsOrigin) {
    origin = corsOrigin.split(',').map((o) => o.trim());
  } else if (isProduction) {
    origin = [];
    Logger.warn(
      '⚠️  CORS_ORIGIN not set in production - CORS is disabled. Set CORS_ORIGIN environment variable to allow specific origins.',
    );
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
  const port = parseInt(process.env.PORT || '3100', 10);

  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${port}/${globalPrefix} (QUEUE_ROLE=${role})`);

  if (shouldEnableBullBoard(role)) {
    const { username } = readBullBoardAuthConfig();

    Logger.log(`📊 Bull Board: http://localhost:${port}${readBullBoardPath()} (HTTP Basic, user ${username})`);
  }
}
