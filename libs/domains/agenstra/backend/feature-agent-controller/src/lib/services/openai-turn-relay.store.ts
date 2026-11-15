import { createHash, randomUUID } from 'node:crypto';

import {
  createKeyValueClientFromEnv,
  isKeyValueStoreEnabled,
  readKeyValueKeyPrefix,
  type KeyValueClient,
} from '@forepath/shared/backend/util-redis-cache';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/** Who may continue a client tool turn: same principal, workspace, agent and chat session. */
export interface ClientToolTurnBinding {
  /** Authenticated principal and credential lineage (see `clientToolTurnPrincipal`). */
  principal: string;
  clientId: string;
  agentId: string;
  chatId: string;
}

/** Valkey record of a client tool call handed to an API client (lookup by call id from any API replica). */
export interface RelayedCallRecord {
  turnId: string;
  /** API replica holding the turn (agent-manager socket). */
  owner: string;
  binding: ClientToolTurnBinding;
}

/**
 * Cross-replica hand-off of client tool turns over Valkey / Redis (driver-agnostic key-value port, `CACHE_CLIENT`).
 *
 * A client tool turn lives on the API replica that started it (it holds the agent-manager socket). When the API client
 * returns tool results to another replica, that replica forwards them through a per-turn inbox list and receives the
 * turn's updates through a per-request outbox list. All keys carry the connection key prefix and expire.
 *
 * Fail-soft: without Valkey (`CACHE_ENABLED=false`, unreachable) only same-replica continuation works.
 */
@Injectable()
export class OpenAiTurnRelayStore implements OnModuleDestroy {
  /** Identity of this API replica (process). */
  readonly instanceId = randomUUID();
  private readonly logger = new Logger(OpenAiTurnRelayStore.name);
  private client: KeyValueClient | null = null;
  private connectPromise: Promise<KeyValueClient | null> | null = null;

  async onModuleDestroy(): Promise<void> {
    const client = this.client;

    this.client = null;
    this.connectPromise = null;
    await client?.close().catch(() => undefined);
  }

  isEnabled(): boolean {
    return isKeyValueStoreEnabled();
  }

  async registerCall(callId: string, record: RelayedCallRecord, ttlSeconds: number): Promise<boolean> {
    return this.run(
      'register',
      async (client) => {
        await client.set(this.key('call', callId), JSON.stringify(record), ttlSeconds);

        return true;
      },
      false,
    );
  }

  async lookupCall(callId: string): Promise<RelayedCallRecord | null> {
    return this.run(
      'lookup',
      async (client) => {
        const raw = await client.get(this.key('call', callId));

        return raw ? (JSON.parse(raw) as RelayedCallRecord) : null;
      },
      null,
    );
  }

  async deleteCall(callId: string): Promise<void> {
    await this.run('delete', async (client) => client.del(this.key('call', callId)), undefined);
  }

  /**
   * Legacy `functions` replies carry no call id: the pending call is found by function name within the binding
   * (principal, workspace, agent, chat). One call at a time (legacy turns are never parallel).
   */
  async registerLegacyCall(
    binding: ClientToolTurnBinding,
    name: string,
    callId: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.run(
      'register legacy',
      async (client) => client.set(this.legacyKey(binding, name), callId, ttlSeconds),
      undefined,
    );
  }

  async lookupLegacyCall(binding: ClientToolTurnBinding, name: string): Promise<string | null> {
    return this.run('lookup legacy', async (client) => client.get(this.legacyKey(binding, name)), null);
  }

  async deleteLegacyCall(binding: ClientToolTurnBinding, name: string): Promise<void> {
    await this.run('delete legacy', async (client) => client.del(this.legacyKey(binding, name)), undefined);
  }

  private legacyKey(binding: ClientToolTurnBinding, name: string): string {
    const scope = createHash('sha256')
      .update(JSON.stringify([binding.principal, binding.clientId, binding.agentId, binding.chatId]))
      .digest('hex');

    return this.key('legacy', scope, name);
  }

  /** Message to the owner of a turn. */
  async pushInbox(turnId: string, message: unknown, ttlSeconds: number): Promise<boolean> {
    return this.run(
      'push inbox',
      async (client) => {
        await client.rpush(this.key('turn', turnId, 'in'), [JSON.stringify(message)], ttlSeconds);

        return true;
      },
      false,
    );
  }

  async pullInbox<T>(turnId: string, max = 16): Promise<T[]> {
    return this.pull<T>(this.key('turn', turnId, 'in'), max);
  }

  /** Update for the replica serving one continuation request of a turn. */
  async pushOutbox(turnId: string, requestId: string, message: unknown, ttlSeconds: number): Promise<boolean> {
    return this.run(
      'push outbox',
      async (client) => {
        await client.rpush(this.key('turn', turnId, 'out', requestId), [JSON.stringify(message)], ttlSeconds);

        return true;
      },
      false,
    );
  }

  async pullOutbox<T>(turnId: string, requestId: string, max = 64): Promise<T[]> {
    return this.pull<T>(this.key('turn', turnId, 'out', requestId), max);
  }

  private async pull<T>(key: string, max: number): Promise<T[]> {
    return this.run(
      'pull',
      async (client) => {
        const values = await client.lpop(key, max);

        return values.flatMap((value) => {
          try {
            return [JSON.parse(value) as T];
          } catch {
            return [];
          }
        });
      },
      [] as T[],
    );
  }

  private key(...parts: string[]): string {
    return [readKeyValueKeyPrefix(), 'openai', ...parts].join(':');
  }

  private async run<T>(operation: string, fn: (client: KeyValueClient) => Promise<T>, fallback: T): Promise<T> {
    const client = await this.connect();

    if (!client) {
      return fallback;
    }

    try {
      return await fn(client);
    } catch (error) {
      this.logger.warn(`OpenAI turn relay ${operation} failed: ${(error as Error).message}`);

      return fallback;
    }
  }

  private async connect(): Promise<KeyValueClient | null> {
    if (!this.isEnabled()) {
      return null;
    }

    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        const client = createKeyValueClientFromEnv('agenstra-openai-relay');

        await client.connect();
        this.client = client;

        return client;
      })().catch((error: Error) => {
        this.logger.warn(`OpenAI turn relay unavailable: ${error.message}`);
        this.connectPromise = null;

        return null;
      });
    }

    return this.connectPromise;
  }
}
