import { FLEET_ENTITIES } from '@forepath/loadweaver/backend/feature-fleet';
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

function parseTypeOrmLogLevelsFromEnv(
  raw: string | undefined,
): ('query' | 'schema' | 'error' | 'warn' | 'info' | 'log' | 'migration')[] {
  const allow = new Set(['query', 'schema', 'error', 'warn', 'info', 'log', 'migration']);

  return (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => allow.has(v)) as ('query' | 'schema' | 'error' | 'warn' | 'info' | 'log' | 'migration')[];
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
  database: process.env.DB_DATABASE || 'loadweaver_fleet',
  entities: [
    UserEntity,
    RevokedUserTokenEntity,
    UserPersonalAccessTokenEntity,
    // Notification deliveries (identity emails such as login 2FA codes, webhooks) of the shared feature.
    WebhookEndpointEntity,
    WebhookDeliveryEntity,
    EmailDeliveryEntity,
    ...FLEET_ENTITIES,
  ],
  migrations: [
    'src/migrations/*.js',
    'apps/loadweaver/backend-fleet/src/migrations/*.ts',
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
