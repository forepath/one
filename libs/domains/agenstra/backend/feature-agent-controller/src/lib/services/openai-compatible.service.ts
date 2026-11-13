import { randomUUID } from 'node:crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { FilterDropDirection } from '../entities/statistics-chat-filter-drop.entity';
import { FilterFlagDirection } from '../entities/statistics-chat-filter-flag.entity';
import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { OpenAiApiError } from '../utils/openai-compatible-errors';
import { OPENAI_DEFAULT_MODEL_ID } from '../utils/openai-compatible-request.utils';
import { buildModel, modelOwner } from '../utils/openai-compatible-response.utils';

import { AgentConsoleStatusService } from './agent-console-status.service';
import { ClientAgentChatsProxyService } from './client-agent-chats-proxy.service';
import { ClientAgentProxyService } from './client-agent-proxy.service';
import { OpencodeEffectiveConfigSyncService } from './opencode-effective-config-sync.service';
import { RemoteAgentsSessionService, type RemoteVisibleChatTurnResult } from './remote-agents-session.service';
import { StatisticsService } from './statistics.service';

/** Set to `false` to disable the OpenAI-compatible API (routes answer 404). Enabled by default. */
export const OPENAI_COMPATIBLE_API_ENABLED_ENV = 'OPENAI_COMPATIBLE_API_ENABLED';

export function isOpenAiCompatibleApiEnabled(): boolean {
  return (process.env[OPENAI_COMPATIBLE_API_ENABLED_ENV] ?? '').trim().toLowerCase() !== 'false';
}

/** Aliases that keep the agent's default model. */
const DEFAULT_MODEL_ALIASES = new Set([OPENAI_DEFAULT_MODEL_ID, 'agenstra']);

export interface OpenAiTurnParams {
  clientId: string;
  agentId: string;
  chatId: string;
  prompt: string;
  /** Resolved OpenCode model; undefined keeps the agent default. */
  model?: string;
  userId?: string | null;
  signal?: AbortSignal;
  /** Called with live text deltas only when {@link OpenAiCompatibleService.canStreamDeltas} allowed it. */
  onDeltaText?: (delta: string) => void;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * OpenAI-compatible API on top of agent chat sessions: model and chat session resolution, message filter policy,
 * and one persisted chat turn with the same side effects as a console turn (statistics, `chat_message.created` /
 * `message_filter.triggered` / `agent.chat_failed` notifications, console activity status).
 */
@Injectable()
export class OpenAiCompatibleService {
  private readonly logger = new Logger(OpenAiCompatibleService.name);

  constructor(
    private readonly remoteAgents: RemoteAgentsSessionService,
    private readonly clientAgentProxy: ClientAgentProxyService,
    private readonly chatsProxy: ClientAgentChatsProxyService,
    private readonly effectiveConfigSync: OpencodeEffectiveConfigSyncService,
    private readonly statisticsService: StatisticsService,
    private readonly notificationPublisher: AgenstraNotificationPublisher,
    private readonly agentConsoleStatus: AgentConsoleStatusService,
  ) {}

  async listModels(clientId: string, agentId: string) {
    const models = await this.clientAgentProxy.listClientAgentModels(clientId, agentId);
    const ids = Object.keys(models ?? {}).filter((id) => !DEFAULT_MODEL_ALIASES.has(id));

    return {
      object: 'list' as const,
      data: [buildModel(OPENAI_DEFAULT_MODEL_ID, 'agenstra'), ...ids.map((id) => buildModel(id, modelOwner(id)))],
    };
  }

  async getModel(clientId: string, agentId: string, modelId: string) {
    const list = await this.listModels(clientId, agentId);
    const model = list.data.find((entry) => entry.id === modelId);

    if (!model) {
      throw OpenAiApiError.notFound(`The model '${modelId}' does not exist`, 'model_not_found', 'model');
    }

    return model;
  }

  /** OpenCode model for the turn: undefined for the default alias, otherwise one of the agent's models. */
  async resolveModel(clientId: string, agentId: string, requested: string): Promise<string | undefined> {
    if (DEFAULT_MODEL_ALIASES.has(requested)) {
      return undefined;
    }

    const models = await this.clientAgentProxy.listClientAgentModels(clientId, agentId);

    if (!Object.prototype.hasOwnProperty.call(models ?? {}, requested)) {
      throw OpenAiApiError.notFound(`The model '${requested}' does not exist`, 'model_not_found', 'model');
    }

    return requested;
  }

  /**
   * Visible chat session of the agent: the requested one (must belong to this agent) or the primary session.
   */
  async resolveChatId(clientId: string, agentId: string, requested?: string): Promise<string> {
    if (requested) {
      try {
        const session = await this.chatsProxy.get(clientId, agentId, requested);

        return session.id;
      } catch (error) {
        if (error instanceof NotFoundException) {
          throw OpenAiApiError.notFound('Chat session not found', 'conversation_not_found', 'chat_id');
        }

        throw error;
      }
    }

    const agent = await this.clientAgentProxy.getClientAgent(clientId, agentId);

    if (!agent.primaryChatId) {
      throw OpenAiApiError.notFound('The agent has no primary chat session', 'conversation_not_found');
    }

    return agent.primaryChatId;
  }

  /**
   * Live deltas are emitted by the agent-manager before outgoing message filters run. They may only reach an API
   * caller when no enabled outgoing `drop` / `replace` rule applies to the agent; otherwise the caller receives the
   * filtered final answer only. Fails closed (no live deltas) when the policy cannot be resolved.
   */
  async canStreamDeltas(clientId: string, agentId: string): Promise<boolean> {
    try {
      const platformPolicy = await this.effectiveConfigSync.buildPlatformPolicy(clientId, agentId);

      return !platformPolicy.messageFilters.some(
        (rule) =>
          rule.enabled &&
          (rule.action === 'drop' || rule.action === 'replace') &&
          (rule.direction === 'outgoing' || rule.direction === 'bidirectional'),
      );
    } catch (error) {
      this.logger.warn(
        `Could not resolve message filters for agent ${agentId}; streaming filtered answers only: ${(error as Error).message}`,
      );

      return false;
    }
  }

  async runTurn(params: OpenAiTurnParams): Promise<RemoteVisibleChatTurnResult> {
    const userId = params.userId ?? null;

    this.notificationPublisher.publishChatMessage(params.clientId, {
      agentId: params.agentId,
      direction: 'incoming',
      source: 'user',
      message: params.prompt,
      userId,
      chatId: params.chatId,
    });

    let result: RemoteVisibleChatTurnResult;

    try {
      result = await this.remoteAgents.sendVisibleChatTurn({
        clientId: params.clientId,
        agentId: params.agentId,
        chatId: params.chatId,
        message: params.prompt,
        correlationId: `openai:${randomUUID()}`,
        model: params.model,
        userId,
        signal: params.signal,
        onDeltaText: params.onDeltaText,
        onFilterResult: (filterResult) => this.recordFilterResult(params, filterResult),
      });
    } catch (error) {
      if (!(error instanceof NotFoundException) && !params.signal?.aborted) {
        this.notificationPublisher.publishAgentChatFailed(params.clientId, {
          agentId: params.agentId,
          message: (error as Error).message,
          code: 'CHAT_ERROR',
        });
      }

      throw error;
    }

    if (result.finishReason === 'stop') {
      this.notificationPublisher.publishChatMessage(params.clientId, {
        agentId: params.agentId,
        direction: 'outgoing',
        source: 'agent',
        message: result.text,
        userId,
        chatId: params.chatId,
      });
    }

    void this.agentConsoleStatus
      .onAgentChatActivity(params.clientId, params.agentId, params.chatId)
      .catch(() => undefined);

    return result;
  }

  /** Same statistics and `message_filter.triggered` notifications as a console turn (see ClientsGateway). */
  private recordFilterResult(params: OpenAiTurnParams, payload: Record<string, unknown>): void {
    const outgoing = payload['direction'] === 'outgoing';
    const matchedFilter = (payload['matchedFilter'] ?? undefined) as
      | { type?: string; displayName?: string; reason?: string }
      | undefined;
    const filterType = matchedFilter?.type ?? 'unknown';
    const filterDisplayName = matchedFilter?.displayName ?? 'Unknown Filter';
    const userId = params.userId ?? undefined;
    const message = typeof payload['message'] === 'string' ? (payload['message'] as string) : '';
    const counted = outgoing ? message : message || params.prompt;
    const words = counted ? wordCount(counted) : 0;
    const chars = counted.length;

    if (payload['status'] === 'dropped') {
      void this.statisticsService
        .recordChatFilterDrop(
          params.clientId,
          params.agentId,
          filterType,
          filterDisplayName,
          outgoing ? FilterDropDirection.OUTGOING : FilterDropDirection.INCOMING,
          outgoing ? 0 : words,
          outgoing ? 0 : chars,
          userId,
          matchedFilter?.reason,
        )
        .catch(() => undefined);
      this.notificationPublisher.publishMessageFilterTriggered(params.clientId, {
        agentId: params.agentId,
        direction: outgoing ? 'outgoing' : 'incoming',
        status: 'dropped',
        filterType,
        filterDisplayName,
        reason: matchedFilter?.reason ?? null,
        wordCount: outgoing ? 0 : words,
        charCount: outgoing ? 0 : chars,
        userId: params.userId ?? null,
      });

      return;
    }

    void this.statisticsService
      .recordChatFilterFlag(
        params.clientId,
        params.agentId,
        filterType,
        filterDisplayName,
        outgoing ? FilterFlagDirection.OUTGOING : FilterFlagDirection.INCOMING,
        words,
        chars,
        userId,
        matchedFilter?.reason,
      )
      .catch(() => undefined);
    this.notificationPublisher.publishMessageFilterTriggered(params.clientId, {
      agentId: params.agentId,
      direction: outgoing ? 'outgoing' : 'incoming',
      status: 'filtered',
      filterType,
      filterDisplayName,
      reason: matchedFilter?.reason ?? null,
      wordCount: words,
      charCount: chars,
      userId: params.userId ?? null,
      messagePreview: counted || null,
    });
  }
}
