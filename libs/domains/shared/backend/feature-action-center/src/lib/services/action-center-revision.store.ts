import { randomUUID } from 'node:crypto';

import {
  createKeyValueClientFromEnv,
  isKeyValueStoreEnabled,
  readKeyValueKeyPrefix,
  type KeyValueClient,
} from '@forepath/shared/backend/util-redis-cache';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { ACTION_CENTER_MODULE_OPTIONS, buildActionCenterRevisionKey } from '../constants/action-center.constants';
import type { ActionCenterModuleOptions } from '../interfaces/action-center-module.options';

/** Revisions expire after a day without changes (watchers then simply keep their last state). */
const REVISION_TTL_SECONDS = 86_400;
/** Recent own revisions remembered per process. */
const OWN_REVISION_MEMORY = 64;

/**
 * Cross-process change signal: every process that changes data (API replicas, queue workers) writes a new random
 * revision for the scope; API processes with connected viewers poll it and recompute on change. With
 * `CACHE_ENABLED=false` the store is off and changes only propagate within the process (plus the periodic refresh).
 */
@Injectable()
export class ActionCenterRevisionStore implements OnModuleDestroy {
  private readonly logger = new Logger(ActionCenterRevisionStore.name);
  private client: KeyValueClient | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly keyPrefix = readKeyValueKeyPrefix();
  private lastFailureLogAt = 0;
  /** Revisions written by this process (their changes were already handled locally). */
  private readonly ownRevisions: string[] = [];

  constructor(@Inject(ACTION_CENTER_MODULE_OPTIONS) private readonly options: ActionCenterModuleOptions) {}

  isEnabled(): boolean {
    return isKeyValueStoreEnabled();
  }

  async bump(scopeKey: string): Promise<string | null> {
    const client = await this.ensureConnected();

    if (!client) {
      return null;
    }

    const revision = randomUUID();

    try {
      await client.set(this.key(scopeKey), revision, REVISION_TTL_SECONDS);
      this.ownRevisions.push(revision);

      if (this.ownRevisions.length > OWN_REVISION_MEMORY) {
        this.ownRevisions.shift();
      }

      return revision;
    } catch (error) {
      this.logFailure('write', error);

      return null;
    }
  }

  /** Whether this process wrote `revision` (no need to react to it again). */
  isOwnRevision(revision: string | null): boolean {
    return revision !== null && this.ownRevisions.includes(revision);
  }

  /** Current revisions of the given scopes (`null` when unknown / store unavailable). */
  async read(scopeKeys: readonly string[]): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    const client = scopeKeys.length > 0 ? await this.ensureConnected() : null;

    if (!client) {
      return result;
    }

    try {
      const values = await client.mget(scopeKeys.map((scopeKey) => this.key(scopeKey)));

      scopeKeys.forEach((scopeKey, index) => result.set(scopeKey, values[index] ?? null));
    } catch (error) {
      this.logFailure('read', error);
    }

    return result;
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;

    this.client = null;
    this.connectPromise = null;

    if (client) {
      await client.close().catch(() => undefined);
    }
  }

  private key(scopeKey: string): string {
    return buildActionCenterRevisionKey(this.keyPrefix, this.options.applicationId, scopeKey);
  }

  private async ensureConnected(): Promise<KeyValueClient | null> {
    if (!this.isEnabled()) {
      return null;
    }

    if (!this.client) {
      this.client = createKeyValueClientFromEnv(`forepath-action-center-${this.options.applicationId}`);
    }

    if (!this.connectPromise) {
      this.connectPromise = this.client.connect().catch((error: Error) => {
        this.connectPromise = null;
        throw error;
      });
    }

    try {
      await this.connectPromise;
    } catch (error) {
      this.logFailure('connect', error);

      return null;
    }

    return this.client;
  }

  /** At most one warning per minute: the store is polled every few seconds. */
  private logFailure(operation: string, error: unknown): void {
    const now = Date.now();

    if (now - this.lastFailureLogAt < 60_000) {
      return;
    }

    this.lastFailureLogAt = now;
    this.logger.warn(`Action center revision ${operation} failed: ${(error as Error)?.message ?? error}`);
  }
}
