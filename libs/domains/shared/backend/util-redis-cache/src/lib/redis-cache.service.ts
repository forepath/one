import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { recordSharedCounter, recordSharedHistogram } from '@forepath/shared/backend/util-otel/metrics';

import { createKeyValueClient } from './key-value-client/create-key-value-client';
import type { KeyValueClient } from './key-value-client/key-value-client';
import { readRedisConnectionConfig, readConnectionEnv } from './redis-connection.config';

/**
 * Thin Valkey/Redis JSON cache wrapper. The client library follows `CACHE_CLIENT` (GLIDE by default).
 * Failures are logged and treated as cache misses so callers can always fall back to live data sources.
 */
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: KeyValueClient | null = null;
  private connectPromise: Promise<void> | null = null;

  private isEnabled(): boolean {
    return readConnectionEnv(process.env, 'CACHE_ENABLED')?.toLowerCase() !== 'false';
  }

  private async ensureConnected(): Promise<KeyValueClient | null> {
    if (!this.isEnabled()) {
      return null;
    }

    if (!this.client) {
      this.client = createKeyValueClient({ config: readRedisConnectionConfig(), clientName: 'forepath-cache' });
    }

    if (!this.connectPromise) {
      this.connectPromise = this.client
        .connect()
        .then(() => undefined)
        .catch((error: Error) => {
          this.connectPromise = null;
          throw error;
        });
    }

    try {
      await this.connectPromise;
    } catch (error) {
      this.logger.warn(`Redis cache connection failed: ${(error as Error).message}`);

      return null;
    }

    return this.client;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const startedAt = Date.now();
    const client = await this.ensureConnected();

    if (!client) {
      this.recordCacheOperation('get', 'disabled', Date.now() - startedAt);

      return null;
    }

    try {
      const raw = await client.get(key);

      if (!raw) {
        this.recordCacheOperation('get', 'miss', Date.now() - startedAt);

        return null;
      }

      this.recordCacheOperation('get', 'hit', Date.now() - startedAt);

      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.warn(`Redis cache get failed for key ${key}: ${(error as Error).message}`);
      this.recordCacheOperation('get', 'error', Date.now() - startedAt);

      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
    const startedAt = Date.now();
    const client = await this.ensureConnected();

    if (!client) {
      this.recordCacheOperation('set', 'disabled', Date.now() - startedAt);

      return false;
    }

    try {
      await client.set(key, JSON.stringify(value), ttlSeconds);
      this.recordCacheOperation('set', 'hit', Date.now() - startedAt);

      return true;
    } catch (error) {
      this.logger.warn(`Redis cache set failed for key ${key}: ${(error as Error).message}`);
      this.recordCacheOperation('set', 'error', Date.now() - startedAt);

      return false;
    }
  }

  /**
   * Atomically read and delete a JSON value (GETDEL).
   * Returns null on miss, disabled Redis, or errors (same fail-open posture as {@link getJson}).
   */
  async takeJson<T>(key: string): Promise<T | null> {
    const startedAt = Date.now();
    const client = await this.ensureConnected();

    if (!client) {
      this.recordCacheOperation('get', 'disabled', Date.now() - startedAt);

      return null;
    }

    try {
      const raw = await client.getDel(key);

      if (!raw) {
        this.recordCacheOperation('get', 'miss', Date.now() - startedAt);

        return null;
      }

      this.recordCacheOperation('get', 'hit', Date.now() - startedAt);

      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.warn(`Redis cache take failed for key ${key}: ${(error as Error).message}`);
      this.recordCacheOperation('get', 'error', Date.now() - startedAt);

      return null;
    }
  }

  private recordCacheOperation(
    operation: 'get' | 'set',
    outcome: 'hit' | 'miss' | 'error' | 'disabled',
    durationMs: number,
  ): void {
    const attrs = { operation, outcome };

    recordSharedCounter('redis_cache.operations_total', attrs);
    recordSharedHistogram('redis_cache.operation_duration_ms', durationMs, attrs);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.close();
    } catch (error) {
      this.logger.warn(`Redis cache disconnect failed: ${(error as Error).message}`);
    } finally {
      this.client = null;
      this.connectPromise = null;
    }
  }
}
