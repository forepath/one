/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

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
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import axios from 'axios';
import { DataSource } from 'typeorm';

import { AppModule } from './app/app.module';
import { typeormConfig, typeormConfigForConfigurationOverrides } from './typeorm.config';

async function preloadWorkspaceConfigurationOverrides(logger: Logger): Promise<void> {
  const preloadDataSource = new DataSource(typeormConfigForConfigurationOverrides);

  try {
    await preloadDataSource.initialize();

    if (!typeormConfig.synchronize && typeormConfig.migrations?.length) {
      logger.log('🔄 Running pending config migrations...');
      await preloadDataSource.runMigrations();
      logger.log('✅ Config migrations completed successfully');
    } else if (typeormConfig.synchronize) {
      logger.log('ℹ️  Schema synchronization enabled - config migrations skipped');
    }

    logger.log('🔄 Loading config overrides...');

    const overrides = await preloadDataSource.getRepository(WorkspaceConfigurationOverrideEntity).find();

    for (const override of overrides) {
      const settingKey = override.settingKey as WorkspaceConfigurationSettingKey;
      const envVarName = WORKSPACE_CONFIGURATION_ENV_BY_SETTING[settingKey];

      if (!envVarName) {
        continue;
      }

      process.env[envVarName] = override.value;
    }

    logger.log(`✅ Loaded ${overrides.length} config override(s)`);
  } finally {
    if (preloadDataSource.isInitialized) {
      await preloadDataSource.destroy();
    }
  }
}

async function bootstrap() {
  assertProductionEncryptionKeyOrExit(new Logger('EncryptionKey'));
  await preloadWorkspaceConfigurationOverrides(new Logger('WorkspaceConfigurationOverridesBootstrap'));

  const appLogger = new CorrelationAwareConsoleLogger({ json: true, colors: false });

  Logger.overrideLogger(appLogger);
  registerAxiosCorrelationIdPropagation(axios);

  const app = await NestFactory.create(AppModule, {
    logger: appLogger,
  });
  const httpLogger = new Logger('HTTP');

  app.use(
    createCorrelationIdMiddleware({
      log: (message: string) => httpLogger.log(message),
    }),
  );
  app.use(createOriginAllowlistMiddleware(new Logger('OriginAllowlist')));
  // Configure CORS
  // In production: CORS is restricted by default (requires CORS_ORIGIN to be set)
  // In development: CORS allows all origins by default (can be restricted via CORS_ORIGIN)
  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigin = process.env.CORS_ORIGIN;
  let origin: string | string[];

  if (corsOrigin) {
    // If CORS_ORIGIN is explicitly set, use it (comma-separated list)
    origin = corsOrigin.split(',').map((o) => o.trim());
  } else if (isProduction) {
    // In production, if CORS_ORIGIN is not set, default to empty array (no CORS)
    // This is the most secure default for production
    origin = [];
    Logger.warn(
      '⚠️  CORS_ORIGIN not set in production - CORS is disabled. Set CORS_ORIGIN environment variable to allow specific origins.',
    );
  } else {
    // In development, allow all origins by default
    origin = '*';
  }

  app.enableCors({
    origin,
    // credentials can only be true when origin is not '*'
    credentials: origin !== '*' && Array.isArray(origin) && origin.length > 0,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id', 'X-Request-Id'],
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'X-Correlation-Id'],
  });

  if (Array.isArray(origin) && origin.length > 0) {
    Logger.log(`🌐 CORS enabled with restricted origins: ${origin.join(', ')}`);
  } else if (origin === '*') {
    Logger.log('🌐 CORS enabled with origin: * (all origins allowed - development mode)');
  } else {
    Logger.log('🌐 CORS disabled (no origins allowed)');
  }

  // Configure WebSocket adapter for Socket.IO
  app.useWebSocketAdapter(new CorrelationAwareSocketIoAdapter(app));

  // Run migrations automatically on startup if synchronize is disabled
  // Note: If synchronize: true, schema is auto-synced from entities and migrations won't run
  // To use migrations, set synchronize: false in typeorm.config.ts
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

  app.setGlobalPrefix(globalPrefix);
  const port = parseInt(process.env.PORT || '3000', 10);

  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${port}/${globalPrefix}`);
  Logger.log(
    `🔌 Socket.IO WebSocket gateway is running on: http://localhost:${process.env.WEBSOCKET_PORT || '8080'}/agents`,
  );
}

bootstrap();
