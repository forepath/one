import type { QueueOptions } from 'bullmq';
import { readKeyValueClientDriver } from '@forepath/shared/backend/util-redis-cache';

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

export function toBullMqConnection(config: RedisConnectionConfig): QueueOptions['connection'] {
  return {
    host: config.host,
    port: config.port,
    db: config.db,
    ...(config.password ? { password: config.password } : {}),
  };
}

export function readQueueWorkerConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = parseInt(env.QUEUE_WORKER_CONCURRENCY ?? '5', 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

export function readBullBoardPath(env: NodeJS.ProcessEnv = process.env): string {
  const path = env.QUEUE_BULL_BOARD_PATH?.trim() || '/admin/queues';

  return path.startsWith('/') ? path : `/${path}`;
}

export interface BullBoardAuthConfig {
  username: string;
  password: string;
}

/** Defaults: username `admin`; password must be set via env (compose uses `bullmq` locally). */
export function readBullBoardAuthConfig(env: NodeJS.ProcessEnv = process.env): BullBoardAuthConfig {
  return {
    username: env.QUEUE_BULL_BOARD_USERNAME?.trim() || 'admin',
    password: env.QUEUE_BULL_BOARD_PASSWORD?.trim() ?? '',
  };
}

export function isBullBoardAuthConfigured(config: BullBoardAuthConfig = readBullBoardAuthConfig()): boolean {
  return config.password.length > 0;
}
