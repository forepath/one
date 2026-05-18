import {
  AgentConsoleRegexFilterRuleClientEntity,
  AgentConsoleRegexFilterRuleEntity,
  AgentConsoleRegexFilterRuleSyncTargetEntity,
  ProvisioningReferenceEntity,
  StatisticsAgentEntity,
  StatisticsChatFilterDropEntity,
  StatisticsChatFilterFlagEntity,
  StatisticsChatIoEntity,
  StatisticsClientEntity,
  StatisticsClientUserEntity,
  StatisticsEntityEventEntity,
  StatisticsProvisioningReferenceEntity,
  StatisticsUserEntity,
  ClientAgentAutonomyEntity,
  AtlassianSiteConnectionEntity,
  ExternalImportConfigEntity,
  ExternalImportSyncMarkerEntity,
  KnowledgeNodeEntity,
  KnowledgeNodeEmbeddingEntity,
  KnowledgePageActivityEntity,
  KnowledgeRelationEntity,
  TicketActivityEntity,
  TicketAutomationLeaseEntity,
  TicketAutomationRunEntity,
  TicketAutomationRunStepEntity,
  TicketAutomationEntity,
  TicketBodyGenerationSessionEntity,
  TicketCommentEntity,
  TicketEntity,
  UserEnvironmentReadStateEntity,
} from '@forepath/framework/backend';
import { CorrelationAwareTypeOrmLogger } from '@forepath/framework/backend/util-http-context';
import { ClientAgentCredentialEntity, ClientEntity, ClientUserEntity, UserEntity } from '@forepath/identity/backend';
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
  database: process.env.DB_DATABASE || 'agent_manager',
  entities: [
    ClientEntity,
    ClientAgentCredentialEntity,
    ClientUserEntity,
    ProvisioningReferenceEntity,
    UserEntity,
    StatisticsUserEntity,
    StatisticsClientEntity,
    StatisticsAgentEntity,
    StatisticsProvisioningReferenceEntity,
    StatisticsClientUserEntity,
    StatisticsChatIoEntity,
    StatisticsChatFilterDropEntity,
    StatisticsChatFilterFlagEntity,
    StatisticsEntityEventEntity,
    TicketEntity,
    TicketCommentEntity,
    TicketActivityEntity,
    TicketBodyGenerationSessionEntity,
    TicketAutomationEntity,
    TicketAutomationRunEntity,
    TicketAutomationLeaseEntity,
    TicketAutomationRunStepEntity,
    ClientAgentAutonomyEntity,
    AtlassianSiteConnectionEntity,
    ExternalImportConfigEntity,
    ExternalImportSyncMarkerEntity,
    KnowledgeNodeEntity,
    KnowledgeNodeEmbeddingEntity,
    KnowledgePageActivityEntity,
    KnowledgeRelationEntity,
    AgentConsoleRegexFilterRuleEntity,
    AgentConsoleRegexFilterRuleClientEntity,
    AgentConsoleRegexFilterRuleSyncTargetEntity,
    UserEnvironmentReadStateEntity,
  ],
  migrations: [
    'src/migrations/*.js',
    'apps/backend-agent-controller/src/migrations/*.ts',
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
 *
 * Note: TypeORM CLI uses ts-node, which requires tsconfig-paths/register
 * to resolve path aliases. The migration commands set TS_NODE_PROJECT
 * to use tsconfig.migrations.json which includes path mapping configuration.
 */
export default new DataSource(typeormConfig);
