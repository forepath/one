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

import {
  bundleUploadTimeoutMs,
  createRequestTimeoutMiddleware,
  databaseTarget,
  databaseWriteGuard,
  FLEET_IDENTITY_HEADER,
  RegistryProxyService,
} from '@forepath/loadweaver/backend/feature-control-plane';

import { AppModule } from './app/app.module';
import { installAppLogger } from './app-logger';
import { bodyParserErrorHandler } from './body-parser-errors';
import { trustProxySetting } from './trust-proxy';
import { typeormConfig } from './typeorm.config';
import { CORS_ALLOWED_HEADERS, CORS_EXPOSED_HEADERS } from './cors';

const GLOBAL_PREFIX = 'api';

export async function bootstrap(): Promise<void> {
  // Installed by main.ts already (JSON from the first line); again here for callers that import bootstrap directly.
  const appLogger = installAppLogger();

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

    // SIGTERM runs the shutdown hooks: BullMQ workers / queues close, then the shared GLIDE queue client.
    context.enableShutdownHooks();

    Logger.log(`Loadweaver control plane background process started (QUEUE_ROLE=${role})`);
    await context.init();

    return;
  }

  const app = await createApp(appLogger);

  // SIGTERM runs the shutdown hooks: BullMQ workers / queues close, then the shared GLIDE queue client.
  app.enableShutdownHooks();
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
  const trustProxy = trustProxySetting();

  // Behind a same-host TLS proxy (Cloud nginx): client IPs from X-Forwarded-For for the throttlers (H1).
  if (trustProxy) app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  const httpLogger = new Logger('HTTP');

  app.use(
    createCorrelationIdMiddleware({
      log: (message: string) => httpLogger.log(message),
    }),
  );
  app.use(createOriginAllowlistMiddleware(new Logger('OriginAllowlist')));
  // Database handover / read-only fallback (3.43): writes 503 with a clear message, reads served.
  app.use(databaseWriteGuard());
  // Request receive timeout per route (2026-10-27): Node's 5-minute default for every route except the release bundle
  // upload, which may take LOADWEAVER_BUNDLE_UPLOAD_TIMEOUT_MS (default 2 h, like the fleet relay's stream limit).
  // Node's server-wide requestTimeout is switched off below; its header timeout stays.
  app.use(
    createRequestTimeoutMiddleware([
      { method: 'POST', path: `/${GLOBAL_PREFIX}/updates/bundles`, ms: bundleUploadTimeoutMs() },
    ]),
  );
  (app.getHttpServer() as { requestTimeout: number }).requestTimeout = 0;
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
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
  });

  // `docker push` / `pull` against the API host (3.22): streamed to the members' registry, before any body parser.
  app.use('/v2', app.get(RegistryProxyService).handler());

  // File uploads of the file browser (3.19): raw bytes, at most 10 MB per request (larger files in chunks).
  app.use('/api/live/files/content', express.raw({ type: () => true, limit: '10mb' }));

  // Git webhooks (3.29): signatures are over the raw body, so it stays a Buffer (pushes of large repos stay small).
  app.use('/api/git/webhooks', express.raw({ type: () => true, limit: '5mb' }));

  // YAML bundles for plans can be larger than regular JSON bodies (bounded by the plan DTO, 2 MiB).
  // Signed fleet identities (3.24) bind the body: keep the raw JSON bytes of requests that carry a claim.
  app.use(
    express.json({
      limit: '3mb',
      verify: (req, _res, buf) => {
        if (req.headers[FLEET_IDENTITY_HEADER]) (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  // Parser failures never echo or log the body (a secret value on `PUT …/secrets/:name`, 3.40).
  app.use(bodyParserErrorHandler((message) => httpLogger.warn(message)));

  // Read-only from the external copy (3.43): migrations run once the members' database is back.
  if (databaseTarget.fallback)
    Logger.warn('Skipping database migrations: read-only from the external copy', 'Migrations');
  else await runPendingMigrationsIfRoleAllows(app, role, typeormConfig);

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
