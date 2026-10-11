import { createCorrelationAwareSocketIoClient } from '@forepath/shared/backend/util-http-context';
import { AuthenticationType } from '@forepath/identity/backend';
import { ClientAgentCredentialsRepository } from '@forepath/identity/backend';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Socket as ClientSocket } from 'socket.io-client';
import type { AgenstraAutomationTurnStatus } from '@forepath/agenstra/shared/util-opencode-config';

import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildRemoteAgentsSocketUrl } from '../utils/remote-manager-url.utils';
import { extractAutomationTurnStatus } from '../utils/automation-turn-status';
import { extractPlanTurnStatus, type AgenstraPlanTurnStatusPayload } from '../utils/chat-plan-turn-status';

import { ClientsService } from './clients.service';
import { StatisticsService } from './statistics.service';

export interface RemoteChatSyncParams {
  clientId: string;
  agentId: string;
  message: string;
  correlationId: string;
  continue?: boolean;
  resumeSessionSuffix?: string;
  /** OpenCode `provider/model` — required for automation (no auto model). */
  model?: string;
  /** When set, records statistics under this kind instead of default chat. */
  statisticsInteractionKind?: StatisticsInteractionKind;
  /** Overrides `REMOTE_AGENT_CHAT_TIMEOUT_MS` for the agent response wait (e.g. shorter commit-message generation). */
  chatTimeoutMs?: number;
  contextInjection?: {
    includeWorkspace?: boolean;
    environmentIds?: string[];
    autoEnrichmentEnabled?: boolean;
    ticketShas?: string[];
  };
  /**
   * When true, settle only on final `result` frames (ignore intermediate status/question payloads)
   * and return structured automation turn status when present.
   */
  expectAutomationTurnStatus?: boolean;
}

export interface RemoteChatSyncResult {
  text: string;
  turnStatus?: AgenstraAutomationTurnStatus;
}

export interface RemoteChatStreamingParams {
  clientId: string;
  agentId: string;
  message: string;
  correlationId: string;
  continue?: boolean;
  resumeSessionSuffix?: string;
  /** Visible chat session id — when set (execute path), omit resumeSessionSuffix. */
  chatId?: string;
  /** Defaults to true for hidden plan sessions; false for visible execute. */
  ephemeral?: boolean;
  /**
   * When true with ephemeral false, agent replies stay visible but the injected user prompt
   * is not persisted/emitted (chat-plan execute).
   */
  suppressUserMessage?: boolean;
  /** Automation trust marker — must stay false/undefined for plan mode. */
  unattendedAutomation?: boolean;
  model?: string;
  statisticsInteractionKind?: StatisticsInteractionKind;
  chatTimeoutMs?: number;
  contextInjection?: {
    includeWorkspace?: boolean;
    environmentIds?: string[];
    autoEnrichmentEnabled?: boolean;
    ticketShas?: string[];
  };
  onDeltaText?: (delta: string) => void | Promise<void>;
  onEvent?: (event: unknown) => void | Promise<void>;
}

export interface RemoteChatStreamingResult {
  text: string;
  planTurnStatus?: AgenstraPlanTurnStatusPayload;
}

/**
 * Short-lived Socket.IO client to the client's agent-manager namespace for synchronous `chat` turns.
 * Extracts the credential + URL wiring from {@link ClientsGateway} without coupling to UI sockets.
 */
@Injectable()
export class RemoteAgentsSessionService {
  private readonly logger = new Logger(RemoteAgentsSessionService.name);

  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly clientsService: ClientsService,
    private readonly clientAgentCredentialsRepository: ClientAgentCredentialsRepository,
    private readonly statisticsService: StatisticsService,
  ) {}

  private buildAgentsWsUrl(endpoint: string): string {
    return buildRemoteAgentsSocketUrl(endpoint);
  }

  private async getAuthHeader(clientId: string): Promise<string> {
    const client = await this.clientsRepository.findByIdOrThrow(clientId);

    if (client.authenticationType === AuthenticationType.API_KEY) {
      if (!client.apiKey) {
        throw new BadRequestException('API key not configured for client');
      }

      return `Bearer ${client.apiKey}`;
    }

    if (client.authenticationType === AuthenticationType.KEYCLOAK) {
      const token = await this.clientsService.getAccessToken(clientId);

      return `Bearer ${token}`;
    }

    throw new BadRequestException('Unsupported authentication type');
  }

  private extractAgentText(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
      return '';
    }

    const envelope = payload as { success?: boolean; data?: { from?: string; response?: unknown } };

    if (!envelope.success || !envelope.data || envelope.data.from !== 'agent') {
      return '';
    }

    const r = envelope.data.response;

    if (typeof r === 'string') {
      return r;
    }

    if (r && typeof r === 'object' && 'result' in (r as object)) {
      const res = (r as { result?: unknown }).result;

      return typeof res === 'string' ? res : JSON.stringify(res);
    }

    if (r && typeof r === 'object' && String((r as { type?: unknown }).type) === 'agenstra_turn') {
      const parts = (r as { parts?: unknown }).parts;

      if (Array.isArray(parts)) {
        for (let i = parts.length - 1; i >= 0; i--) {
          const part = parts[i];

          if (part && typeof part === 'object' && String((part as { type?: unknown }).type) === 'result') {
            const res = (part as { result?: unknown }).result;

            if (typeof res === 'string') {
              return res;
            }

            if (res !== undefined) {
              return JSON.stringify(res);
            }
          }
        }
      }
    }

    return JSON.stringify(r);
  }

  private isFinalAgentResult(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const envelope = payload as { success?: boolean; data?: { from?: string; response?: unknown } };

    if (!envelope.success || !envelope.data || envelope.data.from !== 'agent') {
      return false;
    }

    const r = envelope.data.response;

    if (!r || typeof r !== 'object') {
      return false;
    }

    const type = String((r as { type?: unknown }).type);

    if (type === 'result') {
      const record = r as { is_error?: unknown; subtype?: unknown };

      if (record.is_error === true || String(record.subtype ?? '') === 'error') {
        return false;
      }

      return true;
    }

    if (type === 'agenstra_turn' && Array.isArray((r as { parts?: unknown }).parts)) {
      return (r as { parts: unknown[] }).parts.some((part) => {
        if (!part || typeof part !== 'object') {
          return false;
        }

        const record = part as { type?: unknown; is_error?: unknown; subtype?: unknown };

        return String(record.type) === 'result' && record.is_error !== true && String(record.subtype ?? '') !== 'error';
      });
    }

    return false;
  }

  /**
   * Connects to the remote agents gateway, logs in, sends one non-streaming `chat`, returns aggregated agent text.
   */
  async sendChatSync(params: RemoteChatSyncParams): Promise<RemoteChatSyncResult> {
    const client = await this.clientsRepository.findByIdOrThrow(params.clientId);
    const authHeader = await this.getAuthHeader(params.clientId);

    await validateClientEndpointWithDnsOrThrow(client.endpoint);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);
    const remoteUrl = this.buildAgentsWsUrl(client.endpoint);
    const remote: ClientSocket = createCorrelationAwareSocketIoClient(remoteUrl, {
      transports: ['websocket'],
      extraHeaders: { Authorization: authHeader },
      rejectUnauthorized: tlsPolicy.rejectUnauthorized,
      reconnection: false,
    });
    const creds = await this.clientAgentCredentialsRepository.findByClientAndAgent(params.clientId, params.agentId);

    if (!creds?.password) {
      throw new BadRequestException('No stored credentials for this agent');
    }

    const chatTimeoutMs = params.chatTimeoutMs ?? parseInt(process.env.REMOTE_AGENT_CHAT_TIMEOUT_MS || '600000', 10);
    const expectAutomation = params.expectAutomationTurnStatus === true;

    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new BadRequestException('Remote socket connect timeout')), 15000);

        remote.once('connect', () => {
          clearTimeout(t);
          resolve();
        });
        remote.once('connect_error', (err: Error) => {
          clearTimeout(t);
          reject(err);
        });
      });

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new BadRequestException('Remote login timeout')), 10000);

        remote.once('loginSuccess', () => {
          clearTimeout(t);
          resolve();
        });
        remote.once('loginError', (err: unknown) => {
          clearTimeout(t);
          const msg = (err as { error?: { message?: string } })?.error?.message ?? 'login failed';

          reject(new BadRequestException(msg));
        });
        remote.emit('login', { agentId: params.agentId, password: creds.password });
      });

      const wordCount = params.message.trim().split(/\s+/).filter(Boolean).length;
      const charCount = params.message.length;
      const kind = params.statisticsInteractionKind ?? StatisticsInteractionKind.CHAT;

      await this.statisticsService.recordChatInput(
        params.clientId,
        params.agentId,
        wordCount,
        charCount,
        undefined,
        kind,
      );

      const output = await new Promise<RemoteChatSyncResult>((resolve, reject) => {
        let settled = false;
        let lastText = '';
        let lastStatus: AgenstraAutomationTurnStatus | undefined;
        const t = setTimeout(() => {
          if (!settled) {
            settled = true;
            remote.off('chatMessage', onChatMessage);
            reject(new BadRequestException('Timed out waiting for agent chat response'));
          }
        }, chatTimeoutMs);
        const onChatMessage = (msg: unknown) => {
          const text = this.extractAgentText(msg);
          const turnStatus = extractAutomationTurnStatus(msg);

          if (text) {
            lastText = text;
          }

          if (turnStatus) {
            lastStatus = turnStatus;
          }

          if (expectAutomation) {
            if (!this.isFinalAgentResult(msg)) {
              return;
            }

            if (!settled) {
              settled = true;
              clearTimeout(t);
              remote.off('chatMessage', onChatMessage);
              resolve({ text: lastText || text, turnStatus: lastStatus ?? turnStatus });
            }

            return;
          }

          if (text && !settled) {
            settled = true;
            clearTimeout(t);
            remote.off('chatMessage', onChatMessage);
            resolve({ text, turnStatus: lastStatus ?? turnStatus });
          }
        };

        remote.on('chatMessage', onChatMessage);
        remote.emit('chat', {
          message: params.message,
          correlationId: params.correlationId,
          responseMode: 'sync',
          ephemeral: true,
          continue: params.continue ?? false,
          resumeSessionSuffix: params.resumeSessionSuffix,
          contextInjection: params.contextInjection,
          ...(params.model ? { model: params.model } : {}),
          // Trust marker required by agent-manager for -ticket-auto-* allow-all sessions.
          unattendedAutomation: true,
        });
      });
      const outWords = output.text.trim().split(/\s+/).filter(Boolean).length;

      await this.statisticsService.recordChatOutput(
        params.clientId,
        params.agentId,
        outWords,
        output.text.length,
        undefined,
        kind,
      );

      return output;
    } catch (error: unknown) {
      this.logger.warn(`sendChatSync failed: ${(error as Error).message}`);
      throw error instanceof BadRequestException ? error : new BadRequestException('Remote chat failed');
    } finally {
      try {
        remote.removeAllListeners();
        remote.disconnect();
      } catch {
        // ignore
      }
    }
  }

  private extractChatEventDelta(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
      return '';
    }

    const envelope = payload as {
      success?: boolean;
      data?: { kind?: string; payload?: { delta?: unknown; text?: unknown } };
      kind?: string;
      payload?: { delta?: unknown; text?: unknown };
    };
    const data = envelope.data ?? envelope;
    const kind = typeof data.kind === 'string' ? data.kind : '';

    if (kind !== 'assistantDelta' && kind !== 'assistantMessage') {
      return '';
    }

    const eventPayload = data.payload;

    if (!eventPayload || typeof eventPayload !== 'object') {
      return '';
    }

    if (typeof eventPayload.delta === 'string') {
      return eventPayload.delta;
    }

    if (typeof eventPayload.text === 'string' && kind === 'assistantDelta') {
      return eventPayload.text;
    }

    return '';
  }

  private extractChatEventKind(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
      return '';
    }

    const envelope = payload as { data?: { kind?: unknown }; kind?: unknown };
    const kind = envelope.data?.kind ?? envelope.kind;

    return typeof kind === 'string' ? kind : '';
  }

  private extractChatEventAssistantText(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
      return '';
    }

    const envelope = payload as {
      data?: { kind?: string; payload?: { text?: unknown } };
      kind?: string;
      payload?: { text?: unknown };
    };
    const data = envelope.data ?? envelope;

    if (data.kind !== 'assistantMessage') {
      return '';
    }

    const text = data.payload?.text;

    return typeof text === 'string' ? text : '';
  }

  /**
   * Streaming remote chat turn: listens to `chatEvent` deltas and settles on terminal
   * `assistantMessage` chatEvent (OpenCode stream path) or final `chatMessage` (sync/single path).
   * Used by chat plan explore/refine (ephemeral + resumeSessionSuffix) and execute (chatId visible).
   */
  async sendChatStreaming(params: RemoteChatStreamingParams): Promise<RemoteChatStreamingResult> {
    const client = await this.clientsRepository.findByIdOrThrow(params.clientId);
    const authHeader = await this.getAuthHeader(params.clientId);

    await validateClientEndpointWithDnsOrThrow(client.endpoint);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);
    const remoteUrl = this.buildAgentsWsUrl(client.endpoint);
    const remote: ClientSocket = createCorrelationAwareSocketIoClient(remoteUrl, {
      transports: ['websocket'],
      extraHeaders: { Authorization: authHeader },
      rejectUnauthorized: tlsPolicy.rejectUnauthorized,
      reconnection: false,
    });
    const creds = await this.clientAgentCredentialsRepository.findByClientAndAgent(params.clientId, params.agentId);

    if (!creds?.password) {
      throw new BadRequestException('No stored credentials for this agent');
    }

    const chatTimeoutMs = params.chatTimeoutMs ?? parseInt(process.env.REMOTE_AGENT_CHAT_TIMEOUT_MS || '600000', 10);
    const ephemeral = params.ephemeral !== false;
    const useChatId = typeof params.chatId === 'string' && params.chatId.length > 0;

    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new BadRequestException('Remote socket connect timeout')), 15000);

        remote.once('connect', () => {
          clearTimeout(t);
          resolve();
        });
        remote.once('connect_error', (err: Error) => {
          clearTimeout(t);
          reject(err);
        });
      });

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new BadRequestException('Remote login timeout')), 10000);

        remote.once('loginSuccess', () => {
          clearTimeout(t);
          resolve();
        });
        remote.once('loginError', (err: unknown) => {
          clearTimeout(t);
          const msg = (err as { error?: { message?: string } })?.error?.message ?? 'login failed';

          reject(new BadRequestException(msg));
        });
        remote.emit('login', { agentId: params.agentId, password: creds.password });
      });

      const wordCount = params.message.trim().split(/\s+/).filter(Boolean).length;
      const charCount = params.message.length;
      const kind = params.statisticsInteractionKind ?? StatisticsInteractionKind.CHAT;

      await this.statisticsService.recordChatInput(
        params.clientId,
        params.agentId,
        wordCount,
        charCount,
        undefined,
        kind,
      );

      const output = await new Promise<RemoteChatStreamingResult>((resolve, reject) => {
        let settled = false;
        let lastText = '';
        let lastPlanStatus: AgenstraPlanTurnStatusPayload | undefined;
        const t = setTimeout(() => {
          if (!settled) {
            settled = true;
            remote.off('chatMessage', onChatMessage);
            remote.off('chatEvent', onChatEvent);
            reject(new BadRequestException('Timed out waiting for agent chat response'));
          }
        }, chatTimeoutMs);
        const settle = (text: string, planTurnStatus?: AgenstraPlanTurnStatusPayload) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(t);
          remote.off('chatMessage', onChatMessage);
          remote.off('chatEvent', onChatEvent);
          resolve({ text, planTurnStatus });
        };
        const onChatEvent = (msg: unknown) => {
          void Promise.resolve(params.onEvent?.(msg)).catch(() => undefined);

          const delta = this.extractChatEventDelta(msg);

          if (delta) {
            lastText = `${lastText}${delta}`;
            void Promise.resolve(params.onDeltaText?.(delta)).catch(() => undefined);
          }

          const planStatus = extractPlanTurnStatus(msg);

          if (planStatus) {
            lastPlanStatus = planStatus;
          }

          const eventKind = this.extractChatEventKind(msg);

          // OpenCode stream path emits terminal `assistantMessage` (from `result` / idle) without `chatMessage`.
          if (eventKind === 'assistantMessage') {
            const assistantText = this.extractChatEventAssistantText(msg);

            if (assistantText) {
              lastText = assistantText;
            }

            settle(lastText, lastPlanStatus);
          }
        };
        const onChatMessage = (msg: unknown) => {
          const text = this.extractAgentText(msg);
          const planStatus = extractPlanTurnStatus(msg);

          if (text) {
            lastText = text;
          }

          if (planStatus) {
            lastPlanStatus = planStatus;
          }

          if (this.isFinalAgentResult(msg) || text) {
            settle(lastText || text, lastPlanStatus ?? planStatus);
          }
        };

        remote.on('chatEvent', onChatEvent);
        remote.on('chatMessage', onChatMessage);
        remote.emit('chat', {
          message: params.message,
          correlationId: params.correlationId,
          responseMode: 'stream',
          ephemeral,
          continue: params.continue ?? false,
          ...(useChatId ? { chatId: params.chatId } : { resumeSessionSuffix: params.resumeSessionSuffix }),
          contextInjection: params.contextInjection,
          ...(params.model ? { model: params.model } : {}),
          ...(params.unattendedAutomation === true ? { unattendedAutomation: true } : {}),
          ...(params.suppressUserMessage === true ? { suppressUserMessage: true } : {}),
        });
      });
      const outWords = output.text.trim().split(/\s+/).filter(Boolean).length;

      await this.statisticsService.recordChatOutput(
        params.clientId,
        params.agentId,
        outWords,
        output.text.length,
        undefined,
        kind,
      );

      return output;
    } catch (error: unknown) {
      this.logger.warn(`sendChatStreaming failed: ${(error as Error).message}`);
      throw error instanceof BadRequestException ? error : new BadRequestException('Remote chat failed');
    } finally {
      try {
        remote.removeAllListeners();
        remote.disconnect();
      } catch {
        // ignore
      }
    }
  }
}
