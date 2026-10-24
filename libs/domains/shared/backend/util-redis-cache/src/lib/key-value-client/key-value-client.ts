import type { RedisConnectionConfig } from '../redis-connection.config';

/** Client library for Valkey connections (key/value port and, via util-queue, BullMQ). Default: `glide`. */
export type KeyValueClientDriver = 'ioredis' | 'glide';

export const KEY_VALUE_CLIENT_DRIVERS: readonly KeyValueClientDriver[] = ['glide', 'ioredis'];

export const DEFAULT_KEY_VALUE_CLIENT_DRIVER: KeyValueClientDriver = 'glide';

/**
 * Narrow key/value port over Valkey/Redis covering exactly the commands the cache and
 * update stores use. Adapters translate to ioredis or Valkey GLIDE; callers stay driver-agnostic.
 */
export interface KeyValueClient {
  readonly driver: KeyValueClientDriver;
  /** Establishes the connection; rejects when the server is unreachable. */
  connect(): Promise<void>;
  ping(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  /** Atomic GET + DEL (GETDEL). */
  getDel(key: string): Promise<string | null>;
  /** SET, optionally with an `EX` expiry in seconds. */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  mget(keys: string[]): Promise<(string | null)[]>;
  /** One SCAN iteration; returns the next cursor (`'0'` when complete) and matched keys. */
  scan(cursor: string, match: string, count: number): Promise<[string, string[]]>;
  close(): Promise<void>;
}

export interface KeyValueClientOptions {
  config: RedisConnectionConfig;
  /** Reported to the server as CLIENT SETNAME where supported. */
  clientName?: string;
}

/**
 * Reads `CACHE_CLIENT` (`glide` default, or `ioredis`). Unknown values resolve to `null`
 * so the caller can warn and fall back.
 */
export function readKeyValueClientDriver(env: NodeJS.ProcessEnv = process.env): KeyValueClientDriver | null {
  const raw = env['CACHE_CLIENT']?.trim().toLowerCase();

  if (!raw) {
    return DEFAULT_KEY_VALUE_CLIENT_DRIVER;
  }

  return (KEY_VALUE_CLIENT_DRIVERS as readonly string[]).includes(raw) ? (raw as KeyValueClientDriver) : null;
}
