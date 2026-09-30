import { Injectable, Logger } from '@nestjs/common';

import { OpenCodeClientFactory } from './opencode-client.factory';
import type { Event } from './opencode-sdk.types';

type EventListener = (event: Event) => void;

interface WorkerSubscription {
  listeners: Set<EventListener>;
  abort: AbortController;
  started: Promise<void>;
}

/**
 * Shares one SSE `event.subscribe()` stream per worker container and fans out events.
 */
@Injectable()
export class OpenCodeEventBridge {
  private readonly logger = new Logger(OpenCodeEventBridge.name);
  private readonly subscriptions = new Map<string, WorkerSubscription>();

  constructor(private readonly clientFactory: OpenCodeClientFactory) {}

  private workerKey(agentId: string, containerId: string): string {
    return `${agentId}:${containerId}`;
  }

  private eventSessionId(event: Event): string | undefined {
    switch (event.type) {
      case 'message.part.updated':
        return event.properties.part.sessionID;
      case 'message.updated': {
        const info = event.properties.info;

        return typeof info.sessionID === 'string' ? info.sessionID : undefined;
      }
      case 'session.idle':
      case 'session.error':
      case 'permission.updated':
        return event.properties.sessionID;
      case 'permission.asked':
      case 'permission.v2.asked':
      case 'question.asked':
      case 'question.v2.asked': {
        const payload = ('properties' in event && event.properties) || ('data' in event && event.data) || undefined;

        if (payload && typeof payload === 'object' && 'sessionID' in payload) {
          const sessionID = (payload as { sessionID?: unknown }).sessionID;

          return typeof sessionID === 'string' ? sessionID : undefined;
        }

        return undefined;
      }
      default:
        return undefined;
    }
  }

  async *subscribe(
    agentId: string,
    containerId: string,
    sessionId: string,
    signal?: AbortSignal,
  ): AsyncIterable<Event> {
    const queue: Event[] = [];
    let done = false;
    const streamError: unknown | null = null;

    const notify = (() => {
      let resolve: (() => void) | null = null;
      const wait = () =>
        new Promise<void>((r) => {
          resolve = r;
        });
      const wake = () => {
        resolve?.();
        resolve = null;
      };

      return { wait, wake };
    })();

    const listener: EventListener = (event) => {
      if (event.type === 'server.connected') {
        return;
      }

      const eventSessionId = this.eventSessionId(event);

      // Correlate chat turns by session when the event carries a session id.
      if (!eventSessionId || eventSessionId !== sessionId) {
        return;
      }

      queue.push(event);
      notify.wake();
    };

    const workerKey = this.workerKey(agentId, containerId);
    const subscription = await this.ensureWorkerSubscription(agentId, containerId, workerKey);

    subscription.listeners.add(listener);

    const onAbort = () => {
      done = true;
      notify.wake();
    };

    signal?.addEventListener('abort', onAbort);

    try {
      while (!done || queue.length > 0) {
        const item = queue.shift();

        if (item) {
          yield item;
          continue;
        }

        if (done || signal?.aborted) {
          break;
        }

        await notify.wait();
      }

      if (streamError) {
        throw streamError;
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      subscription.listeners.delete(listener);

      if (subscription.listeners.size === 0) {
        subscription.abort.abort();
        this.subscriptions.delete(workerKey);
      }
    }
  }

  private async ensureWorkerSubscription(
    agentId: string,
    containerId: string,
    workerKey: string,
  ): Promise<WorkerSubscription> {
    const existing = this.subscriptions.get(workerKey);

    if (existing) {
      await existing.started;

      return existing;
    }

    const abort = new AbortController();
    const listeners = new Set<EventListener>();
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const subscription: WorkerSubscription = { listeners, abort, started };

    this.subscriptions.set(workerKey, subscription);

    void this.runWorkerStream(agentId, containerId, workerKey, subscription)
      .catch((error: unknown) => {
        const err = error as { message?: string };

        this.logger.warn(`OpenCode event stream ended for ${workerKey}: ${err.message ?? 'unknown error'}`);
      })
      .finally(() => {
        if (this.subscriptions.get(workerKey) === subscription) {
          this.subscriptions.delete(workerKey);
        }
      });

    // Allow first connection attempt to settle briefly before consumers attach.
    resolveStarted();
    await started;

    return subscription;
  }

  private async runWorkerStream(
    agentId: string,
    containerId: string,
    workerKey: string,
    subscription: WorkerSubscription,
  ): Promise<void> {
    const client = await this.clientFactory.getClient(agentId, containerId);
    const result = await client.event.subscribe({
      signal: subscription.abort.signal,
    });

    for await (const event of result.stream) {
      if (subscription.abort.signal.aborted) {
        break;
      }

      const typedEvent = event as Event;

      for (const listener of subscription.listeners) {
        try {
          listener(typedEvent);
        } catch (error) {
          const err = error as { message?: string };

          this.logger.debug(`OpenCode event listener failed for ${workerKey}: ${err.message}`);
        }
      }
    }
  }

  closeForAgent(agentId: string): void {
    const prefix = `${agentId}:`;

    for (const [key, subscription] of this.subscriptions.entries()) {
      if (!key.startsWith(prefix)) {
        continue;
      }

      subscription.abort.abort();
      this.subscriptions.delete(key);
    }
  }
}
