import { createOriginAllowlistMiddleware } from '@forepath/identity/backend';
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

import { RegistryProxyService } from '@forepath/loadweaver/backend/feature-control-plane';

import { AppModule } from './app/app.module';
import { typeormConfig } from './typeorm.config';

const GLOBAL_PREFIX = 'api';

export async function bootstrap(): Promise<void> {
  const appLogger = new CorrelationAwareConsoleLogger({ json: true, colors: false });

  Logger.overrideLogger(appLogger);
  registerAxiosCorrelationIdPropagation(axios);

  const otelConfig = resolveOtelRuntimeConfig(process.env, 'loadweaver-control-plane');
  logOtelStartupStatus(appLogger, otelConfig);

  if (isOtelEffectivelyEnabled(otelConfig)) {
    startOtelSdk(otelConfig);
    process.on('SIGTERM', () => {
      void shutdownOtelSdk();
    });
  }

  assertProductionEncryptionKeyOrExit(new Logger('EncryptionKey'));

  const role = getQueueRole();

  if (!shouldRunApiHttp(role)) {
    const context = await NestFactory.createApplicationContext(AppModule, { logger: appLogger });

    Logger.log(`Loadweaver control plane background process started (QUEUE_ROLE=${role})`);
    await context.init();

    return;
  }

  const app = await createApp(appLogger);
  const port = parseInt(process.env.PORT || '3400', 10);

  await app.listen(port);
  Logger.log(`Loadweaver control plane API running on: http://localhost:${port}/${GLOBAL_PREFIX} (QUEUE_ROLE=${role})`);
}

/** Builds the HTTP application with all middlewares, migrations and pipes (shared by `bootstrap` and integration tests). */
export async function createApp(
  logger: Logger | CorrelationAwareConsoleLogger = new Logger('Loadweaver'),
): Promise<INestApplication> {
  const role = getQueueRole();
  const app = await NestFactory.create(AppModule, { logger, bodyParser: false });
  const httpLogger = new Logger('HTTP');

  app.use(
    createCorrelationIdMiddleware({
      log: (message: string) => httpLogger.log(message),
    }),
  );
  app.use(createOriginAllowlistMiddleware(new Logger('OriginAllowlist')));
  // The control plane's release (3.26): the CLI warns when it is more than one release line behind.
  const version = process.env.VERSION?.trim();

  if (version && /^v?\d+\.\d+\.\d+/.test(version))
    app.use((_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
      res.setHeader('X-Loadweaver-Version', version.replace(/^v/, ''));
      next();
    });
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
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Correlation-Id',
      'X-Request-Id',
      'Range',
      'Content-Range',
      'X-Upload-Id',
    ],
    exposedHeaders: [
      'Content-Length',
      'Content-Disposition',
      'X-Correlation-Id',
      'Content-Range',
      'Accept-Ranges',
      'X-File-Type',
      'X-Loadweaver-Warning',
      'X-Loadweaver-Version',
    ],
  });

  // `docker push` / `pull` against the API host (3.22): streamed to the members' registry, before any body parser.
  app.use('/v2', app.get(RegistryProxyService).handler());

  // File uploads of the file browser (3.19): raw bytes, at most 10 MB per request (larger files in chunks).
  app.use('/api/live/files/content', express.raw({ type: () => true, limit: '10mb' }));

  // Git webhooks (3.29): signatures are over the raw body, so it stays a Buffer (pushes of large repos stay small).
  app.use('/api/git/webhooks', express.raw({ type: () => true, limit: '5mb' }));

  // YAML bundles for plans can be larger than regular JSON bodies (bounded by the plan DTO, 2 MiB).
  app.use(express.json({ limit: '3mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  await runPendingMigrationsIfRoleAllows(app, role, typeormConfig);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const globalPrefixExcludes = [...getOtelMetricsGlobalPrefixExcludes()];

  app.setGlobalPrefix(GLOBAL_PREFIX, globalPrefixExcludes.length > 0 ? { exclude: globalPrefixExcludes } : undefined);

  return app;
}
