import {
  AgentEntity,
  AgentEnvironmentVariableEntity,
  AgentMessageEntity,
  AgentMessageEventEntity,
  DeploymentConfigurationEntity,
  DeploymentRunEntity,
  RegexFilterRuleEntity,
  WorkspaceConfigurationOverrideEntity,
} from '@forepath/agenstra/backend';
import { CorrelationAwareTypeOrmLogger } from '@forepath/shared/backend/util-http-context';
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
    AgentEntity,
    AgentEnvironmentVariableEntity,
    AgentMessageEntity,
    AgentMessageEventEntity,
    DeploymentConfigurationEntity,
    DeploymentRunEntity,
    RegexFilterRuleEntity,
    WorkspaceConfigurationOverrideEntity,
  ],
  // Migration paths:
  // - In development with TypeScript: use path from workspace root
  // - In production/Docker: use relative path from working directory (/app)
  // The path is resolved relative to process.cwd() at runtime
  // In Docker, working directory is /app, so 'src/migrations/*.js' should work
  migrations: [
    // Try production path first (compiled .js files), fallback to development path (.ts files)
    'src/migrations/*.js',
    'apps/backend-agent-manager/src/migrations/*.ts',
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

export const typeormConfigForConfigurationOverrides: DataSourceOptions = {
  ...typeormConfig,
  entities: [WorkspaceConfigurationOverrideEntity],
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
