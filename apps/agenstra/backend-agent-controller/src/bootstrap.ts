import { assertProductionClientEndpointAllowlistConfigured } from '@forepath/agenstra/backend/feature-agent-controller';
import {
  CorrelationAwareConsoleLogger,
  CorrelationAwareSocketIoAdapter,
  createCorrelationIdMiddleware,
  registerAxiosCorrelationIdPropagation,
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
import {
  getOtelMetricsGlobalPrefixExcludes,
  isOtelEffectivelyEnabled,
  logOtelStartupStatus,
  resolveOtelRuntimeConfig,
  shutdownOtelSdk,
  startOtelSdk,
} from '@forepath/shared/backend/util-otel';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import axios from 'axios';
import * as express from 'express';

import { AppModule } from './app/app.module';
import { typeormConfig } from './typeorm.config';

/**
 * Agent file PUT always carries raw bytes. Match by route, not Content-Type —
 * browsers send many MIME types (text/markdown, audio/mpeg, …) and an allowlist
 * silently drops the body for anything unlisted.
 */
function shouldParseAgentFileRawBody(req: express.Request): boolean {
  if (req.method !== 'PUT') {
    return false;
  }

  // /api/clients/:clientId/agents/:agentId/files/...
  return /\/api\/clients\/[^/]+\/agents\/[^/]+\/files\//.test(req.path);
}

export async function bootstrap(): Promise<void> {
  const appLogger = new CorrelationAwareConsoleLogger({ json: true, colors: false });

  Logger.overrideLogger(appLogger);
  registerAxiosCorrelationIdPropagation(axios);

  const otelConfig = resolveOtelRuntimeConfig(process.env, 'agenstra-agent-controller');
  logOtelStartupStatus(appLogger, otelConfig);

  if (isOtelEffectivelyEnabled(otelConfig)) {
    startOtelSdk(otelConfig);
    process.on('SIGTERM', () => {
      void shutdownOtelSdk();
    });
  }

  assertProductionEncryptionKeyOrExit(new Logger('EncryptionKey'));
  assertProductionClientEndpointAllowlistConfigured(new Logger('ClientEndpointAllowlist'));
  assertProductionWebhookEscapeHatchesDisabled(new Logger('WebhookSafety'));

  const role = getQueueRole();

  assertBullBoardAuthConfigured(appLogger);

  const runHttp = shouldRunApiHttp(role) || shouldEnableBullBoard(role);

  if (!runHttp) {
    const context = await NestFactory.createApplicationContext(AppModule, { logger: appLogger });

    Logger.log(`Agent controller queue process started (QUEUE_ROLE=${role})`);
    await context.init();

    return;
  }

  const app = await NestFactory.create(AppModule, { logger: appLogger, bodyParser: false });
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
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Correlation-Id',
      'X-Request-Id',
      'Range',
      'Content-Range',
      'X-File-Type',
      'X-Upload-Id',
      'Content-Disposition',
    ],
    exposedHeaders: [
      'Accept-Ranges',
      'Content-Range',
      'Content-Length',
      'X-Content-Range',
      'X-File-Type',
      'Content-Disposition',
      'X-Correlation-Id',
    ],
  });

  // File PUTs first (any Content-Type), then Nest-equivalent JSON parsers for other routes.
  app.use(
    express.raw({
      type: shouldParseAgentFileRawBody,
      limit: '10mb',
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  await runPendingMigrationsIfRoleAllows(app, role, typeormConfig);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const globalPrefix = 'api';
  const globalPrefixExcludes = [...getBullBoardGlobalPrefixExcludes(), ...getOtelMetricsGlobalPrefixExcludes()];

  app.setGlobalPrefix(globalPrefix, globalPrefixExcludes.length > 0 ? { exclude: globalPrefixExcludes } : undefined);
  const port = parseInt(process.env.PORT || '3100', 10);

  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${port}/${globalPrefix} (QUEUE_ROLE=${role})`);

  if (shouldEnableBullBoard(role)) {
    const { username } = readBullBoardAuthConfig();

    Logger.log(`📊 Bull Board: http://localhost:${port}${readBullBoardPath()} (HTTP Basic, user ${username})`);
  }
}
