/**
 * Shared Postgres compose fragments for provisioned product stacks.
 * Keep the database on the compose network only (no host port publish).
 */
import { buildHealthyDependsOn, type CloudInitComposeServiceParams } from './compose-service.utils';
import { quoteComposeValue } from './env.utils';

export const POSTGRES_COMPOSE_IMAGE = 'postgres:16-alpine';
export const POSTGRES_PGVECTOR_COMPOSE_IMAGE = 'pgvector/pgvector:pg16';
export const POSTGRES_COMPOSE_DEPENDS_ON = buildHealthyDependsOn('postgres');

export interface PostgresConnectionParams {
  host?: string;
  port?: number | string;
  username?: string;
  password?: string;
  database?: string;
}

export interface PostgresComposeServiceParams extends CloudInitComposeServiceParams {
  image?: string;
  username?: string;
  password?: string;
  database?: string;
}

export function buildPostgresBackendEnvLines(database?: PostgresConnectionParams): string[] {
  return [
    `DB_HOST: ${database?.host ?? 'postgres'}`,
    `DB_PORT: ${database?.port ?? '5432'}`,
    `DB_USERNAME: ${database?.username ?? 'postgres'}`,
    `DB_PASSWORD: ${database?.password ?? 'postgres'}`,
    `DB_DATABASE: ${database?.database ?? 'postgres'}`,
  ];
}

export function buildPostgresComposeService(params: PostgresComposeServiceParams): string {
  const username = params.username ?? 'postgres';
  const password = params.password ?? 'postgres';
  const database = params.database ?? 'postgres';
  const image = params.image ?? POSTGRES_COMPOSE_IMAGE;

  return `  postgres:
    image: ${image}
    container_name: ${params.containerName}
    environment:
      POSTGRES_USER: ${quoteComposeValue(username)}
      POSTGRES_PASSWORD: ${quoteComposeValue(password)}
      POSTGRES_DB: ${quoteComposeValue(database)}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${username}']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - ${params.network}
    restart: unless-stopped`;
}
