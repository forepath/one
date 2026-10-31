import { createOriginAllowlistMiddleware } from '@forepath/identity/backend';
import {
  assertProductionClusterEndpointAllowlist,
  fleetRelayStreamTimeoutMs,
} from '@forepath/loadweaver/backend/feature-fleet';
import {
  assertProductionEncryptionKeyOrExit,
  getQueueRole,
  runPendingMigrationsIfRoleAllows,
  shouldRunApiHttp,
} from '@forepath/shared/backend';
import {
  CorrelationAwareConsoleLogger,
  CorrelationAwareSocketIoAdapter,
  createCorrelationIdMiddleware,
  registerAxiosCorrelationIdPropagation,
} from '@forepath/shared/backend/util-http-context';
import {
  getOtelMetricsGlobalPrefixExcludes,
  isOtelEffectivelyEnabled,
  logOtelStartupStatus,
  resolveOtelRuntimeConfig,
  shutdownOtelSdk,
  startOtelSdk,
} from '@forepath/shared/backend/util-otel';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import axios from 'axios';
import * as express from 'express';

import { AppModule } from './app/app.module';
import { installAppLogger } from './app-logger';
import { typeormConfig } from './typeorm.config';
import { CORS_ALLOWED_HEADERS, CORS_EXPOSED_HEADERS } from './cors';

const GLOBAL_PREFIX = 'api';

/** The REST relay streams request bodies to the clusters: no body parser may consume them. */
export const RELAY_PATH = /^\/api\/clusters\/[^/]+\/api\//;

export async function bootstrap(): Promise<void> {
  // Installed by main.ts already (JSON from the first line); again here for callers that import bootstrap directly.
  const appLogger = installAppLogger();

  registerAxiosCorrelationIdPropagation(axios);

  const otelConfig = resolveOtelRuntimeConfig(process.env, 'loadweaver-fleet');

  logOtelStartupStatus(appLogger, otelConfig);

  if (isOtelEffectivelyEnabled(otelConfig)) {
    startOtelSdk(otelConfig);
    process.on('SIGTERM', () => {
      void shutdownOtelSdk();
    });
  }

  assertProductionEncryptionKeyOrExit(new Logger('EncryptionKey'));
  assertProductionClusterEndpointAllowlist(new Logger('ClusterEndpoints'));

  const role = getQueueRole();

  if (!shouldRunApiHttp(role)) {
    const context = await NestFactory.createApplicationContext(AppModule, { logger: appLogger });

    // SIGTERM runs the shutdown hooks: BullMQ workers / queues close, then the shared GLIDE queue client.
    context.enableShutdownHooks();

    Logger.log(`Loadweaver fleet background process started (QUEUE_ROLE=${role})`);
    await context.init();

    return;
  }

  const app = await createApp(appLogger);

  // SIGTERM runs the shutdown hooks: BullMQ workers / queues close, then the shared GLIDE queue client.
  app.enableShutdownHooks();
  const port = parseInt(process.env.PORT || '3500', 10);

  // Streamed bundle uploads through the relay (2026-10-27) may take longer than Node's 5-minute default for receiving
  // a request; the relay itself bounds them by FLEET_RELAY_STREAM_TIMEOUT_MS (header timeout stays the default).
  const server = app.getHttpServer() as { requestTimeout: number };

  server.requestTimeout = Math.max(server.requestTimeout ?? 0, fleetRelayStreamTimeoutMs());

  await app.listen(port);
  Logger.log(`Loadweaver fleet API running on: http://localhost:${port}/${GLOBAL_PREFIX} (QUEUE_ROLE=${role})`);
}

/** Builds the HTTP application with all middlewares, migrations and pipes (shared by `bootstrap` and integration tests). */
export async function createApp(
  logger: Logger | CorrelationAwareConsoleLogger = new Logger('LoadweaverFleet'),
): Promise<INestApplication> {
  const role = getQueueRole();
  const app = await NestFactory.create(AppModule, { logger, bodyParser: false });
  const httpLogger = new Logger('HTTP');

  app.use(createCorrelationIdMiddleware({ log: (message: string) => httpLogger.log(message) }));
  app.use(createOriginAllowlistMiddleware(new Logger('OriginAllowlist')));
  app.useWebSocketAdapter(new CorrelationAwareSocketIoAdapter(app));

  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigin = process.env.CORS_ORIGIN;
  let origin: string | string[];

  if (corsOrigin) {
    origin = corsOrigin.split(',').map((o) => o.trim());
  } else if (isProduction) {
    origin = [];
    Logger.warn('CORS_ORIGIN not set in production - CORS is disabled. Set CORS_ORIGIN to allow specific origins.');
  } else {
    origin = '*';
  }

  app.enableCors({
    origin,
    credentials: origin !== '*' && Array.isArray(origin) && origin.length > 0,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
  });

  // Fleet APIs take JSON; relayed requests keep their raw body stream.
  const json = express.json({ limit: '3mb' });
  const urlencoded = express.urlencoded({ extended: true, limit: '100kb' });

  app.use((req: express.Request, res: express.Response, next: express.NextFunction) =>
    RELAY_PATH.test(req.originalUrl)
      ? next()
      : json(req, res, (error?: unknown) => (error ? next(error) : urlencoded(req, res, next))),
  );

  await runPendingMigrationsIfRoleAllows(app, role, typeormConfig);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const globalPrefixExcludes = [...getOtelMetricsGlobalPrefixExcludes()];

  app.setGlobalPrefix(GLOBAL_PREFIX, globalPrefixExcludes.length > 0 ? { exclude: globalPrefixExcludes } : undefined);

  return app;
}
