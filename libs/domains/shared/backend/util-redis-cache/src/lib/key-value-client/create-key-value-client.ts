import { Logger } from '@nestjs/common';

import { readConnectionEnv, readRedisConnectionConfig } from '../redis-connection.config';

import { GlideKeyValueClient } from './glide-key-value-client';
import { IoRedisKeyValueClient } from './ioredis-key-value-client';
import {
  DEFAULT_KEY_VALUE_CLIENT_DRIVER,
  readKeyValueClientDriver,
  type KeyValueClient,
  type KeyValueClientOptions,
} from './key-value-client';

const logger = new Logger('KeyValueClient');

/** Builds the key/value client selected by `CACHE_CLIENT` (default `glide`, the Valkey project's client). */
export function createKeyValueClient(
  options: KeyValueClientOptions,
  env: NodeJS.ProcessEnv = process.env,
): KeyValueClient {
  let driver = readKeyValueClientDriver(env);

  if (driver === null) {
    driver = DEFAULT_KEY_VALUE_CLIENT_DRIVER;
    logger.warn(`Unknown CACHE_CLIENT "${env['CACHE_CLIENT']}"; falling back to ${driver} (supported: glide, ioredis)`);
  }

  return driver === 'ioredis' ? new IoRedisKeyValueClient(options) : new GlideKeyValueClient(options);
}

/** Client for the configured Valkey / Redis connection (`REDIS_*` / `CACHE_*` env, driver from `CACHE_CLIENT`). */
export function createKeyValueClientFromEnv(clientName: string, env: NodeJS.ProcessEnv = process.env): KeyValueClient {
  return createKeyValueClient({ config: readRedisConnectionConfig(env), clientName }, env);
}

/** `CACHE_ENABLED=false` disables the key/value store (callers fall back to process-local behavior). */
export function isKeyValueStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readConnectionEnv(env, 'CACHE_ENABLED')?.toLowerCase() !== 'false';
}

/** Key prefix of the configured connection (namespaces keys of several deployments sharing one server). */
export function readKeyValueKeyPrefix(env: NodeJS.ProcessEnv = process.env): string {
  return readRedisConnectionConfig(env).keyPrefix;
}
