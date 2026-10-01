import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { recordSharedCounter, recordSharedHistogram } from '@forepath/shared/backend/util-otel/metrics';

import { readRedisConnectionConfig } from './redis-connection.config';

/**
 * Thin Redis JSON cache wrapper. Failures are logged and treated as cache misses
 * so callers can always fall back to live data sources.
 */
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis | null = null;
  private connectPromise: Promise<void> | null = null;

  private isEnabled(): boolean {
    return process.env['REDIS_CACHE_ENABLED']?.trim().toLowerCase() !== 'false';
  }

  private async ensureConnected(): Promise<Redis | null> {
    if (!this.isEnabled()) {
      return null;
    }

    if (!this.client) {
      const config = readRedisConnectionConfig();

      this.client = new Redis({
        host: config.host,
        port: config.port,
        db: config.db,
        ...(config.password ? { password: config.password } : {}),
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
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
      await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      this.recordCacheOperation('set', 'hit', Date.now() - startedAt);

      return true;
    } catch (error) {
      this.logger.warn(`Redis cache set failed for key ${key}: ${(error as Error).message}`);
      this.recordCacheOperation('set', 'error', Date.now() - startedAt);

      return false;
    }
  }

  /**
   * Atomically read and delete a JSON value (GETDEL when available, else GET+DEL).
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
      let raw: string | null = null;

      if (typeof (client as Redis & { getdel?: (k: string) => Promise<string | null> }).getdel === 'function') {
        raw = await (client as Redis & { getdel: (k: string) => Promise<string | null> }).getdel(key);
      } else {
        raw = await client.get(key);

        if (raw) {
          await client.del(key);
        }
      }

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
      await this.client.quit();
    } catch (error) {
      this.logger.warn(`Redis cache disconnect failed: ${(error as Error).message}`);
    } finally {
      this.client = null;
      this.connectPromise = null;
    }
  }
}
