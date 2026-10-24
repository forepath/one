import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { readRedisConnectionConfig, readConnectionEnv } from '@forepath/shared/backend/util-queue';
import { createKeyValueClient, type KeyValueClient } from '@forepath/shared/backend/util-redis-cache';

import {
  buildUpdatesCheckJobKey,
  buildUpdatesInstanceKey,
  buildUpdatesInstanceScanPattern,
  buildUpdatesReleaseKey,
  INSTANCE_HEARTBEAT_TTL_SECONDS,
} from '../constants/updates.constants';
import type { ReleaseSnapshot, ServiceInstanceRecord, UpdateCheckJobMeta } from '../interfaces/updates.interfaces';

/** Valkey/Redis-backed update state; the client library follows `CACHE_CLIENT` (GLIDE by default). */
@Injectable()
export class UpdatesRedisStore implements OnModuleDestroy {
  private readonly logger = new Logger(UpdatesRedisStore.name);
  private client: KeyValueClient | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly keyPrefix: string;

  constructor() {
    this.keyPrefix = readRedisConnectionConfig().keyPrefix;
  }

  private isEnabled(): boolean {
    return readConnectionEnv(process.env, 'CACHE_ENABLED')?.toLowerCase() !== 'false';
  }

  private releaseKey(): string {
    return buildUpdatesReleaseKey(this.keyPrefix);
  }

  private instanceKey(instanceId: string): string {
    return buildUpdatesInstanceKey(this.keyPrefix, instanceId);
  }

  private checkJobKey(): string {
    return buildUpdatesCheckJobKey(this.keyPrefix);
  }

  private async ensureConnected(): Promise<KeyValueClient | null> {
    if (!this.isEnabled()) {
      return null;
    }

    if (!this.client) {
      this.client = createKeyValueClient({ config: readRedisConnectionConfig(), clientName: 'forepath-updates' });
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
      this.logger.warn(`Updates Redis connection failed: ${(error as Error).message}`);

      return null;
    }

    return this.client;
  }

  async ping(): Promise<boolean> {
    const client = await this.ensureConnected();

    if (!client) {
      return false;
    }

    try {
      return await client.ping();
    } catch (error) {
      this.logger.warn(`Updates Redis ping failed: ${(error as Error).message}`);

      return false;
    }
  }

  async getRelease(): Promise<ReleaseSnapshot | null> {
    const client = await this.ensureConnected();

    if (!client) {
      return null;
    }

    try {
      const raw = await client.get(this.releaseKey());

      if (!raw) {
        return null;
      }

      return JSON.parse(raw) as ReleaseSnapshot;
    } catch (error) {
      this.logger.warn(`Updates Redis getRelease failed: ${(error as Error).message}`);

      return null;
    }
  }

  async setRelease(release: ReleaseSnapshot): Promise<void> {
    const client = await this.ensureConnected();

    if (!client) {
      return;
    }

    try {
      await client.set(this.releaseKey(), JSON.stringify(release));
    } catch (error) {
      this.logger.warn(`Updates Redis setRelease failed: ${(error as Error).message}`);
    }
  }

  async listInstances(): Promise<ServiceInstanceRecord[]> {
    const client = await this.ensureConnected();

    if (!client) {
      return [];
    }

    const instances: ServiceInstanceRecord[] = [];
    let cursor = '0';

    try {
      do {
        const [nextCursor, keys] = await client.scan(cursor, buildUpdatesInstanceScanPattern(this.keyPrefix), 100);
        cursor = nextCursor;

        if (keys.length === 0) {
          continue;
        }

        const values = await client.mget(keys);

        for (const raw of values) {
          if (!raw) {
            continue;
          }

          instances.push(JSON.parse(raw) as ServiceInstanceRecord);
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(`Updates Redis listInstances failed: ${(error as Error).message}`);

      return [];
    }

    return instances;
  }

  async getInstance(instanceId: string): Promise<ServiceInstanceRecord | null> {
    const client = await this.ensureConnected();

    if (!client) {
      return null;
    }

    try {
      const raw = await client.get(this.instanceKey(instanceId));

      if (!raw) {
        return null;
      }

      return JSON.parse(raw) as ServiceInstanceRecord;
    } catch (error) {
      this.logger.warn(`Updates Redis getInstance failed: ${(error as Error).message}`);

      return null;
    }
  }

  async upsertInstance(instance: ServiceInstanceRecord): Promise<void> {
    const client = await this.ensureConnected();

    if (!client) {
      return;
    }

    try {
      await client.set(this.instanceKey(instance.instanceId), JSON.stringify(instance), INSTANCE_HEARTBEAT_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Updates Redis upsertInstance failed: ${(error as Error).message}`);
    }
  }

  async setCheckJobMeta(meta: UpdateCheckJobMeta): Promise<void> {
    const client = await this.ensureConnected();

    if (!client) {
      return;
    }

    try {
      await client.set(this.checkJobKey(), JSON.stringify(meta));
    } catch (error) {
      this.logger.warn(`Updates Redis setCheckJobMeta failed: ${(error as Error).message}`);
    }
  }

  async getCheckJobMeta(): Promise<UpdateCheckJobMeta | null> {
    const client = await this.ensureConnected();

    if (!client) {
      return null;
    }

    try {
      const raw = await client.get(this.checkJobKey());

      if (!raw) {
        return null;
      }

      return JSON.parse(raw) as UpdateCheckJobMeta;
    } catch (error) {
      this.logger.warn(`Updates Redis getCheckJobMeta failed: ${(error as Error).message}`);

      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.close();
    } catch (error) {
      this.logger.warn(`Updates Redis disconnect failed: ${(error as Error).message}`);
    } finally {
      this.client = null;
      this.connectPromise = null;
    }
  }
}
