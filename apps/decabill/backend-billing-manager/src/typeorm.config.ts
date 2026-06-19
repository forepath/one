import {
  AvailabilitySnapshotEntity,
  BackorderEntity,
  BillingAuditLogEntity,
  CustomerProfileEntity,
  InvoiceEntity,
  InvoiceVoidDocumentEntity,
  InvoiceLineItemEntity,
  InvoiceNumberSequenceEntity,
  OpenPositionEntity,
  PaymentAttemptEntity,
  PaymentWebhookEventEntity,
  ProviderPriceSnapshotEntity,
  ReservedHostnameEntity,
  ServicePlanEntity,
  ServiceTypeEntity,
  SubscriptionEntity,
  SubscriptionItemEntity,
  UsageRecordEntity,
} from '@forepath/decabill/backend';
import { CorrelationAwareTypeOrmLogger } from '@forepath/shared/backend/util-http-context';
import { UserEntity } from '@forepath/identity/backend';
import { DataSource, DataSourceOptions } from 'typeorm';

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
 * Shared TypeORM configuration used by both NestJS app and CLI migrations.
 * This ensures consistent database configuration across all contexts.
 *
 * Note: synchronize: true enables automatic schema synchronization from entities.
 * This is different from migrations - synchronize auto-creates/updates schema,
 * while migrations run SQL files. If using migrations, set synchronize: false.
 */
export const typeormConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'billing',
  entities: [
    ServiceTypeEntity,
    ServicePlanEntity,
    SubscriptionEntity,
    SubscriptionItemEntity,
    ReservedHostnameEntity,
    UsageRecordEntity,
    InvoiceEntity,
    InvoiceVoidDocumentEntity,
    InvoiceLineItemEntity,
    InvoiceNumberSequenceEntity,
    PaymentAttemptEntity,
    PaymentWebhookEventEntity,
    BillingAuditLogEntity,
    OpenPositionEntity,
    ProviderPriceSnapshotEntity,
    BackorderEntity,
    AvailabilitySnapshotEntity,
    CustomerProfileEntity,
    UserEntity,
  ],
  migrations: [
    'src/migrations/*.js',
    'apps/decabill/backend-billing-manager/src/migrations/*.ts',
    'libs/domains/identity/backend/util-auth/src/lib/migrations/*.ts',
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
 * TypeORM DataSource configuration for CLI operations.
 * This file is used by TypeORM CLI for generating and running migrations.
 */
export default new DataSource(typeormConfig);
