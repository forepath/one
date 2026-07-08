import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

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
    const client = await this.ensureConnected();

    if (!client) {
      return null;
    }

    try {
      const raw = await client.get(key);

      if (!raw) {
        return null;
      }

      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.warn(`Redis cache get failed for key ${key}: ${(error as Error).message}`);

      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const client = await this.ensureConnected();

    if (!client) {
      return;
    }

    try {
      await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Redis cache set failed for key ${key}: ${(error as Error).message}`);
    }
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
