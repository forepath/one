export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
}

/** Mirrors `readRedisConnectionConfig` from util-queue (shared Redis env vars). */
export function readRedisConnectionConfig(env: NodeJS.ProcessEnv = process.env): RedisConnectionConfig {
  const password = env['REDIS_PASSWORD']?.trim();

  return {
    host: env['REDIS_HOST']?.trim() || 'localhost',
    port: parseInt(env['REDIS_PORT'] ?? '6379', 10),
    ...(password ? { password } : {}),
    db: parseInt(env['REDIS_DB'] ?? '0', 10),
    keyPrefix: env['REDIS_KEY_PREFIX']?.trim() || 'agenstra',
  };
}
