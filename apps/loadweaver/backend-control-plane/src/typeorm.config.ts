import { CONTROL_PLANE_ENTITIES } from '@forepath/loadweaver/backend/feature-control-plane';
import { CorrelationAwareTypeOrmLogger } from '@forepath/shared/backend/util-http-context';
import { RevokedUserTokenEntity, UserEntity, UserPersonalAccessTokenEntity } from '@forepath/identity/backend';
import {
  AddWebhookDeliveryLogRetention1774310000000,
  CreateEmailNotificationTables1774330000000,
  CreateWebhookNotificationTables1774300000000,
  EmailDeliveryEntity,
  EnsureWebhookDeliveryEndpointCascade1774320000000,
  WebhookDeliveryEntity,
  WebhookEndpointEntity,
} from '@forepath/shared/backend';
import { DataSource, DataSourceOptions } from 'typeorm';

import { databaseSsl } from './database-tls';

function parseTypeOrmLogLevelsFromEnv(
  raw: string | undefined,
): ('query' | 'schema' | 'error' | 'warn' | 'info' | 'log' | 'migration')[] {
  const allow = new Set(['query', 'schema', 'error', 'warn', 'info', 'log', 'migration']);
  const parts = (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => allow.has(v));

  return parts as ('query' | 'schema' | 'error' | 'warn' | 'info' | 'log' | 'migration')[];
}

/**
 * Shared TypeORM configuration used by both the NestJS app and CLI migrations.
 */
export const typeormConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'loadweaver',
  // TLS against Spilo, verified with the cluster CA on members (DB_SSL_MODE / DB_SSL_CA / DB_SSL_SERVERNAME).
  ssl: databaseSsl(process.env),
  entities: [
    UserEntity,
    RevokedUserTokenEntity,
    UserPersonalAccessTokenEntity,
    // Notification deliveries (3.18 alerts through the shared notifications feature).
    WebhookEndpointEntity,
    WebhookDeliveryEntity,
    EmailDeliveryEntity,
    ...CONTROL_PLANE_ENTITIES,
  ],
  migrations: [
    'src/migrations/*.js',
    'apps/loadweaver/backend-control-plane/src/migrations/*.ts',
    'libs/domains/identity/backend/util-auth/src/lib/migrations/*.ts',
    // Referenced as classes (the shared library's sources are ES modules to TypeORM's file loader).
    CreateWebhookNotificationTables1774300000000,
    AddWebhookDeliveryLogRetention1774310000000,
    EnsureWebhookDeliveryEndpointCascade1774320000000,
    CreateEmailNotificationTables1774330000000,
  ],
  synchronize: false,
  logging:
    process.env.NODE_ENV === 'development'
      ? parseTypeOrmLogLevelsFromEnv(process.env.TYPEORM_LOGGING).length
        ? parseTypeOrmLogLevelsFromEnv(process.env.TYPEORM_LOGGING)
        : ['warn', 'error']
      : false,
  logger: new CorrelationAwareTypeOrmLogger(),
};

/**
 * TypeORM DataSource configuration for CLI operations (migrations).
 */
export default new DataSource(typeormConfig);
