/**
 * Shared Valkey compose fragments for provisioned Decabill and Agenstra Controller stacks.
 * Valkey is the open-source, Redis-compatible drop-in used for BullMQ queues and caching; backends
 * read the `VALKEY_*` environment variables (legacy `REDIS_*` names remain supported). `CACHE_CLIENT: glide`
 * selects Valkey GLIDE for every Valkey connection (BullMQ queues, caches, update state).
 * Keep Valkey on the compose network only (no host port publish); AOF is enabled for BullMQ durability.
 */
import { buildHealthyDependsOn, type CloudInitComposeServiceParams } from './compose-service.utils';

export const VALKEY_COMPOSE_IMAGE =
  'docker.io/valkey/valkey:9.0.6-alpine@sha256:187679e3bd4036959631e3f03983ab2ba503ab21e6fd0454d508e909db2ee989';
export const VALKEY_COMPOSE_DEPENDS_ON = buildHealthyDependsOn('valkey');

export function buildValkeyBackendEnvLines(keyPrefix: string): string[] {
  return [
    'VALKEY_HOST: valkey',
    'VALKEY_PORT: 6379',
    'VALKEY_PASSWORD: ',
    'VALKEY_DB: 0',
    `VALKEY_KEY_PREFIX: ${keyPrefix}`,
    'CACHE_CLIENT: glide',
  ];
}

export function buildValkeyComposeService(params: CloudInitComposeServiceParams): string {
  return `  valkey:
    image: ${VALKEY_COMPOSE_IMAGE}
    container_name: ${params.containerName}
    command: ['valkey-server', '--appendonly', 'yes']
    volumes:
      - valkey_data:/data
    healthcheck:
      test: ['CMD', 'valkey-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - ${params.network}
    restart: unless-stopped`;
}
