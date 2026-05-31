import type { QueueOptions } from 'bullmq';

export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
}

export function readRedisConnectionConfig(env: NodeJS.ProcessEnv = process.env): RedisConnectionConfig {
  const password = env.REDIS_PASSWORD?.trim();

  return {
    host: env.REDIS_HOST?.trim() || 'localhost',
    port: parseInt(env.REDIS_PORT ?? '6379', 10),
    ...(password ? { password } : {}),
    db: parseInt(env.REDIS_DB ?? '0', 10),
    keyPrefix: env.REDIS_KEY_PREFIX?.trim() || 'agenstra',
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
