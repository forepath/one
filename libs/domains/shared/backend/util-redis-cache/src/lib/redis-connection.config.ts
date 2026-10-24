import { readKeyValueClientDriver } from './key-value-client/key-value-client';

export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
}

/**
 * Reads a connection setting from the env family that matches `CACHE_CLIENT`: `glide` (default) prefers
 * `VALKEY_<name>`, `ioredis` prefers the legacy `REDIS_<name>`. The other family is the fallback, so deployments
 * that only set one family keep working with either driver. Blank values count as unset.
 */
export function readConnectionEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const families = readKeyValueClientDriver(env) === 'ioredis' ? ['REDIS', 'VALKEY'] : ['VALKEY', 'REDIS'];

  for (const family of families) {
    const value = env[`${family}_${name}`]?.trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

/** Mirrors `readRedisConnectionConfig` from util-queue (shared `VALKEY_*` / legacy `REDIS_*` env vars). */
export function readRedisConnectionConfig(env: NodeJS.ProcessEnv = process.env): RedisConnectionConfig {
  const password = readConnectionEnv(env, 'PASSWORD');

  return {
    host: readConnectionEnv(env, 'HOST') || 'localhost',
    port: parseInt(readConnectionEnv(env, 'PORT') ?? '6379', 10),
    ...(password ? { password } : {}),
    db: parseInt(readConnectionEnv(env, 'DB') ?? '0', 10),
    keyPrefix: readConnectionEnv(env, 'KEY_PREFIX') || 'agenstra',
  };
}
