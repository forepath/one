import { Injectable, Logger, Optional } from '@nestjs/common';

import type { AgentProviderOptions, AgentResponseObject } from '../agent-provider.interface';
import { OutboundAgentEventPublisher } from '../outbound-agent-event-publisher';

import { OpenCodeClientFactory } from './opencode-client.factory';
import { OpenCodeEventBridge } from './opencode-event-bridge';
import { createOpenCodeToolCallState, OpenCodeEventMapper } from './opencode-event-mapper';
import { OPENCODE_INITIALIZATION_INSTRUCTIONS } from './opencode-provider.config';
import type { PermissionReply } from './opencode-sdk.types';
import { OpenCodeSessionKey, OpenCodeSessionService } from './opencode-session.service';

type PendingInteractionKind = 'permission' | 'question';

/**
 * OpenCode HTTP chat runtime — replaces AcpAgentMessagingService for OpenCodeAgentProvider.
 */
@Injectable()
export class OpenCodeRuntimeService {
  private readonly logger = new Logger(OpenCodeRuntimeService.name);
  /** Tracks permission/question request → session for replies without requiring the caller to know the session. */
  private readonly pendingInteractions = new Map<
    string,
    { agentId: string; sessionId: string; kind: PendingInteractionKind }
  >();

  constructor(
    private readonly clientFactory: OpenCodeClientFactory,
    private readonly sessionService: OpenCodeSessionService,
    private readonly eventBridge: OpenCodeEventBridge,
    private readonly eventMapper: OpenCodeEventMapper,
    @Optional() private readonly outboundPublisher?: OutboundAgentEventPublisher,
  ) {}

  async sendMessage(key: OpenCodeSessionKey, message: string, options?: AgentProviderOptions): Promise<string> {
    const parts: string[] = [];

    for await (const obj of this.streamChatEvents(key, message, options)) {
      parts.push(JSON.stringify(obj));
    }

    return parts.join('\n');
  }

  async *sendMessageStream(
    key: OpenCodeSessionKey,
    message: string,
    options?: AgentProviderOptions,
  ): AsyncIterable<string> {
    for await (const obj of this.streamChatEvents(key, message, options)) {
      yield JSON.stringify(obj);
    }
  }

  async sendInitialization(key: OpenCodeSessionKey, options?: AgentProviderOptions): Promise<void> {
    await this.promptAndDrain(key, OPENCODE_INITIALIZATION_INSTRUCTIONS, options);
  }

  async *streamChatEvents(
    key: OpenCodeSessionKey,
    message: string,
    options?: AgentProviderOptions,
  ): AsyncIterable<AgentResponseObject> {
    yield* this.promptAndDrain(key, message, options);
  }

  /**
   * Reply to an OpenCode permission request (`once` | `always` | `reject`).
   * "Permission request not found" is treated as success — OpenCode auto-clears sibling
   * requests after `always`, so follow-up replies for the same tool are often already gone.
   */
  async replyPermission(
    agentId: string,
    containerId: string,
    permissionId: string,
    reply: PermissionReply,
    sessionId?: string,
  ): Promise<string[]> {
    const mapKey = `${agentId}:${permissionId}`;
    const pending = this.pendingInteractions.get(mapKey);

    if (pending && pending.kind !== 'permission') {
      throw new Error(`Request '${permissionId}' is tracked as a question, not a permission`);
    }

    if (sessionId && pending && sessionId !== pending.sessionId) {
      throw new Error('sessionId does not match the pending permission request');
    }

    const resolvedSessionId = pending?.sessionId ?? sessionId;
    const client = await this.clientFactory.getClient(agentId, containerId);
    const clearSiblings = reply === 'always';

    try {
      if (resolvedSessionId && typeof client.postSessionIdPermissionsPermissionId === 'function') {
        const result = await client.postSessionIdPermissionsPermissionId({
          path: { id: resolvedSessionId, permissionID: permissionId },
          body: { response: reply },
        });

        if (result.error) {
          const err = result.error as { message?: string };
          const message = err.message ?? 'Unknown error';

          if (this.isPermissionRequestNotFound(message)) {
            return this.finalizeInteractionReply(agentId, permissionId, 'permission', clearSiblings);
          }

          throw new Error(`OpenCode permission reply failed: ${message}`);
        }

        return this.finalizeInteractionReply(agentId, permissionId, 'permission', clearSiblings);
      }

      if (client.permission?.reply) {
        const result = await client.permission.reply({
          requestID: permissionId,
          reply,
        });

        if (result.error) {
          const err = result.error as { message?: string };
          const message = err.message ?? 'Unknown error';

          if (this.isPermissionRequestNotFound(message)) {
            return this.finalizeInteractionReply(agentId, permissionId, 'permission', clearSiblings);
          }

          throw new Error(`OpenCode permission reply failed: ${message}`);
        }

        return this.finalizeInteractionReply(agentId, permissionId, 'permission', clearSiblings);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (this.isPermissionRequestNotFound(message)) {
        return this.finalizeInteractionReply(agentId, permissionId, 'permission', clearSiblings);
      }

      throw error;
    }

    throw new Error('OpenCode client does not support permission replies');
  }

  private isPermissionRequestNotFound(message: string): boolean {
    return /permission request not found/i.test(message);
  }

  /**
   * Reply to (or reject) an OpenCode question / form request.
   * `answers` are selected option labels for a single question (wrapped as [[...]] for the API).
   *
   * Uses raw HTTP because `@opencode-ai/sdk` v1 does not expose `client.question`.
   */
  async replyQuestion(
    agentId: string,
    containerId: string,
    questionId: string,
    answers: string[] | undefined,
    reject: boolean,
    sessionId?: string,
  ): Promise<string[]> {
    const mapKey = `${agentId}:${questionId}`;
    const pending = this.pendingInteractions.get(mapKey);

    if (pending && pending.kind !== 'question') {
      throw new Error(`Request '${questionId}' is tracked as a permission, not a question`);
    }

    if (sessionId && pending && sessionId !== pending.sessionId) {
      throw new Error('sessionId does not match the pending question request');
    }

    const { baseUrl, authorization } = await this.clientFactory.resolveConnection(agentId, containerId);
    const encodedId = encodeURIComponent(questionId);

    if (reject) {
      const response = await fetch(`${baseUrl}/question/${encodedId}/reject`, {
        method: 'POST',
        headers: { Authorization: authorization },
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');

        throw new Error(`OpenCode question reject failed: ${response.status}${detail ? ` ${detail}` : ''}`);
      }

      return this.finalizeInteractionReply(agentId, questionId, 'question', false);
    }

    if (!answers || answers.length === 0) {
      throw new Error('Question reply requires at least one answer');
    }

    const response = await fetch(`${baseUrl}/question/${encodedId}/reply`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ answers: [answers] }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      throw new Error(`OpenCode question reply failed: ${response.status}${detail ? ` ${detail}` : ''}`);
    }

    return this.finalizeInteractionReply(agentId, questionId, 'question', false);
  }

  /**
   * Drop the answered request from the pending map; optionally clear sibling pending
   * interactions of the same kind (OpenCode `always` auto-clears other permissions).
   */
  private finalizeInteractionReply(
    agentId: string,
    requestId: string,
    kind: PendingInteractionKind,
    clearSiblings: boolean,
  ): string[] {
    const answered = [requestId];

    this.pendingInteractions.delete(`${agentId}:${requestId}`);

    if (clearSiblings) {
      for (const [key, pending] of [...this.pendingInteractions.entries()]) {
        if (pending.agentId !== agentId || pending.kind !== kind) {
          continue;
        }

        const siblingId = key.startsWith(`${agentId}:`) ? key.slice(agentId.length + 1) : key;

        answered.push(siblingId);
        this.pendingInteractions.delete(key);
      }
    }

    return answered;
  }

  /** Record a pending permission/question so replies can be validated. */
  trackPendingInteraction(agentId: string, requestId: string, sessionId: string, kind: PendingInteractionKind): void {
    this.pendingInteractions.set(`${agentId}:${requestId}`, { agentId, sessionId, kind });
  }

  /** @deprecated Use trackPendingInteraction */
  trackPermissionRequest(agentId: string, permissionId: string, sessionId: string): void {
    this.trackPendingInteraction(agentId, permissionId, sessionId, 'permission');
  }

  private async *promptAndDrain(
    key: OpenCodeSessionKey,
    message: string,
    options?: AgentProviderOptions,
  ): AsyncIterable<AgentResponseObject> {
    const sessionId = await this.sessionService.getOrCreateSessionId(key, options);
    const client = await this.clientFactory.getClient(key.agentId, key.containerId);
    const abort = new AbortController();
    const toolState = createOpenCodeToolCallState();
    let aggregatedText = '';
    let turnDone = false;
    let promptError: unknown | null = null;

    const queue: AgentResponseObject[] = [];
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

    const consumer = (async () => {
      try {
        for await (const event of this.eventBridge.subscribe(key.agentId, key.containerId, sessionId, abort.signal)) {
          const mapped = this.eventMapper.mapEvent(event, toolState, key.agentId);

          for (const obj of mapped) {
            if (obj.type === 'question' && typeof obj.questionId === 'string' && typeof obj.session_id === 'string') {
              const subtype = typeof obj.subtype === 'string' ? obj.subtype : '';
              const kind: PendingInteractionKind =
                subtype === 'permission' || subtype === 'permission.v2' ? 'permission' : 'question';

              this.trackPendingInteraction(key.agentId, obj.questionId, obj.session_id, kind);
            }

            if (obj.type === 'delta' && typeof obj.delta === 'string') {
              aggregatedText += obj.delta;
            } else if (obj.type === 'result' && typeof obj.result === 'string' && !obj.is_error) {
              aggregatedText = obj.result;
            }

            if (obj.type === 'session_idle') {
              turnDone = true;
              notify.wake();
              continue;
            }

            queue.push(obj);
            notify.wake();
          }

          if (turnDone) {
            break;
          }
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          promptError = error;
          turnDone = true;
          notify.wake();
        }
      }
    })();

    try {
      const promptResult = await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: message }],
          ...(options?.model
            ? {
                model: this.parseModelOption(options.model),
              }
            : {}),
        },
      });

      if (promptResult.error) {
        const err = promptResult.error as { message?: string };

        throw new Error(`OpenCode prompt failed: ${err.message ?? 'Unknown prompt error'}`);
      }
    } catch (error) {
      abort.abort();
      await this.sessionService.clearSession(key);
      this.clientFactory.invalidate(key.agentId);
      throw error;
    }

    try {
      while (!turnDone || queue.length > 0) {
        const item = queue.shift();

        if (item) {
          yield item;
          continue;
        }

        if (turnDone) {
          break;
        }

        await notify.wait();
      }

      if (promptError) {
        await this.sessionService.clearSession(key);
        throw promptError;
      }

      if (aggregatedText.trim()) {
        const finalResult = this.eventMapper.buildFinalResult(aggregatedText, sessionId, toolState.lastUsage);

        if (this.outboundPublisher) {
          void this.outboundPublisher.publish(key.agentId, finalResult);
        }

        yield finalResult;
      }
    } finally {
      abort.abort();
      await consumer.catch(() => undefined);
    }
  }

  private parseModelOption(model: string): { providerID: string; modelID: string } {
    const slash = model.indexOf('/');

    if (slash > 0) {
      return {
        providerID: model.slice(0, slash),
        modelID: model.slice(slash + 1),
      };
    }

    return {
      providerID: 'opencode',
      modelID: model,
    };
  }
}
