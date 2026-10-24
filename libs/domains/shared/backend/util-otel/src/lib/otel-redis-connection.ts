import { createValkeyGlideClient, type ConnectionOptions } from 'bullmq';

export interface OtelRedisConnectionConfig {
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
export function readOtelConnectionEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const families = env['CACHE_CLIENT']?.trim().toLowerCase() === 'ioredis' ? ['REDIS', 'VALKEY'] : ['VALKEY', 'REDIS'];

  for (const family of families) {
    const value = env[`${family}_${name}`]?.trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

/**
 * Local Redis env reader for BullMQ OTEL gauges.
 * Kept inside util-otel so buildable consumers of `/metrics` never pull util-queue sources.
 */
export function readOtelRedisConnectionConfig(env: NodeJS.ProcessEnv = process.env): OtelRedisConnectionConfig {
  const password = readOtelConnectionEnv(env, 'PASSWORD');

  return {
    host: readOtelConnectionEnv(env, 'HOST') || 'localhost',
    port: parseInt(readOtelConnectionEnv(env, 'PORT') ?? '6379', 10),
    ...(password ? { password } : {}),
    db: parseInt(readOtelConnectionEnv(env, 'DB') ?? '0', 10),
    keyPrefix: readOtelConnectionEnv(env, 'KEY_PREFIX') || 'agenstra',
  };
}

export function toOtelBullMqConnection(config: OtelRedisConnectionConfig): ConnectionOptions {
  return {
    host: config.host,
    port: config.port,
    db: config.db,
    ...(config.password ? { password: config.password } : {}),
  };
}

/** Per-request timeout for the metrics GLIDE client (job-count scripts only). */
const OTEL_GLIDE_REQUEST_TIMEOUT_MS = 5000;

type GlideModule = typeof import('@valkey/valkey-glide');

export interface OtelBullMqConnectionHandle {
  readonly connection: ConnectionOptions;
  close(): Promise<void>;
}

/**
 * Mirrors util-queue `createBullMqConnection`: `CACHE_CLIENT=ioredis` yields plain ioredis options, anything else
 * (default `glide`) a shared, lazily connecting Valkey GLIDE client wrapped for BullMQ.
 */
export function createOtelBullMqConnection(
  config: OtelRedisConnectionConfig,
  env: NodeJS.ProcessEnv = process.env,
): OtelBullMqConnectionHandle {
  if (env['CACHE_CLIENT']?.trim().toLowerCase() === 'ioredis') {
    return { connection: toOtelBullMqConnection(config), close: async () => undefined };
  }

  // Loaded lazily so ioredis deployments never load the native GLIDE binding.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const glide = require('@valkey/valkey-glide') as GlideModule;
  const client = createValkeyGlideClient(
    glide.GlideClient.createClient({
      addresses: [{ host: config.host, port: config.port }],
      databaseId: config.db,
      ...(config.password ? { credentials: { password: config.password } } : {}),
      requestTimeout: OTEL_GLIDE_REQUEST_TIMEOUT_MS,
      lazyConnect: true,
    }),
  );

  return {
    connection: client,
    close: async () => {
      await client.quit();
    },
  };
}
