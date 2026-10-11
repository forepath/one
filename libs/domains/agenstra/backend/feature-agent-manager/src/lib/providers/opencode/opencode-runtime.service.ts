import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AGENSTRA_AUTOMATION_AGENT_NAME,
  AGENSTRA_AUTOMATION_TURN_STATUS_SCHEMA,
  isAgenstraPlanExplorePermission,
  isAgenstraPlanWritePermission,
  parseAgenstraAutomationTurnStatus,
  type AgenstraAutomationTurnStatus,
} from '@forepath/agenstra/shared/util-opencode-config';

import {
  isChatPlanResumeSessionSuffix,
  isTicketAutomationLoopResumeSessionSuffix,
  isTicketAutomationResumeSessionSuffix,
} from '../../constants/chat-session.constants';
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

  private autoReplyAutomationInteraction(
    key: OpenCodeSessionKey,
    questionId: string,
    kind: PendingInteractionKind,
  ): void {
    const run = async (): Promise<void> => {
      try {
        if (kind === 'permission') {
          await this.replyPermission(key.agentId, key.containerId, questionId, 'always');
        } else {
          await this.replyQuestion(key.agentId, key.containerId, questionId, undefined, true);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(`Automation auto-reply failed for ${kind} ${questionId} on agent ${key.agentId}: ${message}`);
      }
    };

    void run();
  }

  private extractPermissionType(obj: AgentResponseObject): string | undefined {
    const result = obj.result;

    if (result && typeof result === 'object' && 'permissionType' in result) {
      const permissionType = (result as { permissionType?: unknown }).permissionType;

      return typeof permissionType === 'string' ? permissionType : undefined;
    }

    return undefined;
  }

  /**
   * Plan sessions: auto-allow explore permissions, reject write/mutation (and unknown) asks.
   * Non-permission questions are rejected so the explore turn cannot stall on interactive forms.
   */
  private autoReplyPlanInteraction(
    key: OpenCodeSessionKey,
    questionId: string,
    kind: PendingInteractionKind,
    permissionType: string | undefined,
  ): void {
    const run = async (): Promise<void> => {
      try {
        if (kind === 'permission') {
          const reply: PermissionReply =
            isAgenstraPlanExplorePermission(permissionType) && !isAgenstraPlanWritePermission(permissionType)
              ? 'always'
              : 'reject';

          await this.replyPermission(key.agentId, key.containerId, questionId, reply);
        } else {
          await this.replyQuestion(key.agentId, key.containerId, questionId, undefined, true);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(`Plan auto-reply failed for ${kind} ${questionId} on agent ${key.agentId}: ${message}`);
      }
    };

    void run();
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
    let automationTurnStatus: AgenstraAutomationTurnStatus | undefined;
    const automationSession = isTicketAutomationResumeSessionSuffix(key.resumeSessionSuffix);
    const automationLoop = isTicketAutomationLoopResumeSessionSuffix(key.resumeSessionSuffix);
    const planSession = isChatPlanResumeSessionSuffix(key.resumeSessionSuffix);

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

              if (automationSession) {
                this.autoReplyAutomationInteraction(key, obj.questionId, kind);
              } else if (planSession) {
                this.autoReplyPlanInteraction(key, obj.questionId, kind, this.extractPermissionType(obj));
              }
            }

            if (typeof obj.automationTurnStatus === 'string') {
              const parsed = parseAgenstraAutomationTurnStatus(obj.automationTurnStatus);

              if (parsed) {
                automationTurnStatus = parsed;
              }
            }

            if (obj.type === 'tool_result' && typeof obj.name === 'string') {
              const toolName = obj.name.toLowerCase();

              if (toolName === 'structuredoutput' || toolName === 'structured_output') {
                const fromResult = parseAgenstraAutomationTurnStatus(obj.result);
                const fromArgs = parseAgenstraAutomationTurnStatus(obj.args);

                automationTurnStatus = fromResult ?? fromArgs ?? automationTurnStatus;
              }
            }

            if (obj.type === 'delta' && typeof obj.delta === 'string') {
              aggregatedText += obj.delta;
            } else if (obj.type === 'result' && typeof obj.result === 'string' && !obj.is_error) {
              aggregatedText = obj.result;
              const fromResult = parseAgenstraAutomationTurnStatus(obj.result);

              if (fromResult) {
                automationTurnStatus = fromResult;
              }
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
      // Implementation turns must not use format:json_schema — that constraint blocks tool use
      // and collapses the whole turn into status-only text ("Structured output captured successfully.").
      const promptResult = await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: message }],
          ...(options?.model
            ? {
                model: this.parseModelOption(options.model),
              }
            : {}),
          ...(automationSession ? { agent: AGENSTRA_AUTOMATION_AGENT_NAME } : {}),
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

      if (automationLoop && !automationTurnStatus) {
        automationTurnStatus = await this.captureAutomationTurnStatus(key, sessionId, options);
      }

      // Always emit a final result for automation loop turns so sync chat can settle even when
      // the model produced only tool activity and status capture failed.
      if (aggregatedText.trim() || automationTurnStatus || automationLoop) {
        const finalResult = this.eventMapper.buildFinalResult(
          aggregatedText,
          sessionId,
          toolState.lastUsage,
          automationTurnStatus,
        );

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

  /**
   * Follow-up constrained prompt: collect continue/complete without re-running implementation tools.
   */
  private async captureAutomationTurnStatus(
    key: OpenCodeSessionKey,
    sessionId: string,
    options?: AgentProviderOptions,
  ): Promise<AgenstraAutomationTurnStatus | undefined> {
    const client = await this.clientFactory.getClient(key.agentId, key.containerId);
    const abort = new AbortController();
    const toolState = createOpenCodeToolCallState();
    let turnDone = false;
    let promptError: unknown | null = null;
    let automationTurnStatus: AgenstraAutomationTurnStatus | undefined;
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
              this.autoReplyAutomationInteraction(key, obj.questionId, kind);
            }

            if (typeof obj.automationTurnStatus === 'string') {
              const parsed = parseAgenstraAutomationTurnStatus(obj.automationTurnStatus);

              if (parsed) {
                automationTurnStatus = parsed;
              }
            }

            if (obj.type === 'tool_result' && typeof obj.name === 'string') {
              const toolName = obj.name.toLowerCase();

              if (toolName === 'structuredoutput' || toolName === 'structured_output') {
                automationTurnStatus =
                  parseAgenstraAutomationTurnStatus(obj.result) ??
                  parseAgenstraAutomationTurnStatus(obj.args) ??
                  automationTurnStatus;
              }
            }

            if (obj.type === 'result' && typeof obj.result === 'string' && !obj.is_error) {
              automationTurnStatus = parseAgenstraAutomationTurnStatus(obj.result) ?? automationTurnStatus;
            }

            if (obj.type === 'session_idle') {
              turnDone = true;
            }
          }

          if (turnDone) {
            break;
          }
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          promptError = error;
          turnDone = true;
        }
      }
    })();

    try {
      const promptResult = await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts: [
            {
              type: 'text',
              text:
                'Report only the automation turn status for the work just performed. ' +
                'Use status "complete" if the scoped ticket work is implemented and ready for verification; ' +
                'otherwise use "continue". Do not make further code changes.',
            },
          ],
          ...(options?.model
            ? {
                model: this.parseModelOption(options.model),
              }
            : {}),
          agent: AGENSTRA_AUTOMATION_AGENT_NAME,
          format: {
            type: 'json_schema' as const,
            schema: { ...AGENSTRA_AUTOMATION_TURN_STATUS_SCHEMA } as Record<string, unknown>,
            retryCount: 2,
          },
        },
      });

      if (promptResult.error) {
        const err = promptResult.error as { message?: string };

        this.logger.warn(
          `Automation turn-status capture failed for agent ${key.agentId}: ${err.message ?? 'Unknown prompt error'}`,
        );

        return undefined;
      }

      const deadline = Date.now() + 120_000;

      while (!turnDone && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (promptError) {
        this.logger.warn(
          `Automation turn-status drain failed for agent ${key.agentId}: ${(promptError as Error).message ?? 'unknown'}`,
        );
      }

      return automationTurnStatus;
    } catch (error) {
      const err = error as { message?: string };

      this.logger.warn(`Automation turn-status capture error for agent ${key.agentId}: ${err.message ?? 'unknown'}`);

      return undefined;
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
