import {
  WORKSPACE_CONFIGURATION_ENV_BY_SETTING,
  WorkspaceConfigurationOverrideEntity,
  type WorkspaceConfigurationSettingKey,
} from '@forepath/agenstra/backend/feature-agent-manager';
import {
  CorrelationAwareConsoleLogger,
  CorrelationAwareSocketIoAdapter,
  createCorrelationIdMiddleware,
  registerAxiosCorrelationIdPropagation,
} from '@forepath/shared/backend/util-http-context';
import { createOriginAllowlistMiddleware } from '@forepath/identity/backend';
import { assertProductionEncryptionKeyOrExit } from '@forepath/shared/backend';
import {
  getOtelMetricsGlobalPrefixExcludes,
  isOtelEffectivelyEnabled,
  logOtelStartupStatus,
  resolveOtelRuntimeConfig,
  shutdownOtelSdk,
  startOtelSdk,
} from '@forepath/shared/backend/util-otel';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import axios from 'axios';
import * as express from 'express';
import { DataSource } from 'typeorm';

import { AppModule } from './app/app.module';
import { typeormConfig, typeormConfigForConfigurationOverrides } from './typeorm.config';

/**
 * Agent file PUT always carries raw bytes. Match by route, not Content-Type —
 * browsers send many MIME types (text/markdown, audio/mpeg, …) and an allowlist
 * silently drops the body for anything unlisted.
 */
function shouldParseAgentFileRawBody(req: express.Request): boolean {
  if (req.method !== 'PUT') {
    return false;
  }

  // /api/agents/:agentId/files/...
  return /\/api\/agents\/[^/]+\/files\//.test(req.path);
}

async function preloadWorkspaceConfigurationOverrides(): Promise<void> {
  const preloadDataSource = new DataSource(typeormConfigForConfigurationOverrides);

  try {
    await preloadDataSource.initialize();

    if (!typeormConfig.synchronize && typeormConfig.migrations?.length) {
      Logger.log('🔄 Running pending config migrations...', 'WorkspaceConfigurationOverridesBootstrap');
      await preloadDataSource.runMigrations();
      Logger.log('✅ Config migrations completed successfully', 'WorkspaceConfigurationOverridesBootstrap');
    } else if (typeormConfig.synchronize) {
      Logger.log(
        'ℹ️  Schema synchronization enabled - config migrations skipped',
        'WorkspaceConfigurationOverridesBootstrap',
      );
    }

    Logger.log('🔄 Loading config overrides...', 'WorkspaceConfigurationOverridesBootstrap');

    const overrides = await preloadDataSource.getRepository(WorkspaceConfigurationOverrideEntity).find();

    for (const override of overrides) {
      const settingKey = override.settingKey as WorkspaceConfigurationSettingKey;
      const envVarName = WORKSPACE_CONFIGURATION_ENV_BY_SETTING[settingKey];

      if (!envVarName) {
        continue;
      }

      process.env[envVarName] = override.value;
    }

    Logger.log(`✅ Loaded ${overrides.length} config override(s)`, 'WorkspaceConfigurationOverridesBootstrap');
  } finally {
    if (preloadDataSource.isInitialized) {
      await preloadDataSource.destroy();
    }
  }
}

export async function bootstrap(): Promise<void> {
  const appLogger = new CorrelationAwareConsoleLogger({ json: true, colors: false });

  Logger.overrideLogger(appLogger);
  registerAxiosCorrelationIdPropagation(axios);

  const otelConfig = resolveOtelRuntimeConfig(process.env, 'agenstra-agent-manager');
  logOtelStartupStatus(appLogger, otelConfig);

  if (isOtelEffectivelyEnabled(otelConfig)) {
    startOtelSdk(otelConfig);
    process.on('SIGTERM', () => {
      void shutdownOtelSdk();
    });
  }

  assertProductionEncryptionKeyOrExit(new Logger('EncryptionKey'));

  await preloadWorkspaceConfigurationOverrides();

  const app = await NestFactory.create(AppModule, {
    logger: appLogger,
    bodyParser: false,
  });
  const httpLogger = new Logger('HTTP');

  app.use(
    createCorrelationIdMiddleware({
      log: (message: string) => httpLogger.log(message),
    }),
  );
  app.use(createOriginAllowlistMiddleware(new Logger('OriginAllowlist')));
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

  if (Array.isArray(origin) && origin.length > 0) {
    Logger.log(`🌐 CORS enabled with restricted origins: ${origin.join(', ')}`);
  } else if (origin === '*') {
    Logger.log('🌐 CORS enabled with origin: * (all origins allowed - development mode)');
  } else {
    Logger.log('🌐 CORS disabled (no origins allowed)');
  }

  app.useWebSocketAdapter(new CorrelationAwareSocketIoAdapter(app));

  if (!typeormConfig.synchronize && typeormConfig.migrations?.length) {
    const dataSource = app.get(DataSource);

    try {
      Logger.log('🔄 Running pending migrations...');
      await dataSource.runMigrations();
      Logger.log('✅ Migrations completed successfully');
    } catch (error) {
      Logger.error('❌ Failed to run migrations:', error);
      throw error;
    }
  } else if (typeormConfig.synchronize) {
    Logger.log('ℹ️  Schema synchronization enabled - migrations skipped');
  }

  const globalPrefix = 'api';
  const otelExcludes = getOtelMetricsGlobalPrefixExcludes();

  app.setGlobalPrefix(globalPrefix, otelExcludes.length > 0 ? { exclude: otelExcludes } : undefined);
  const port = parseInt(process.env.PORT || '3000', 10);

  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${port}/${globalPrefix}`);
  Logger.log(
    `🔌 Socket.IO WebSocket gateway is running on: http://localhost:${process.env.WEBSOCKET_PORT || '8080'}/agents`,
  );
}
