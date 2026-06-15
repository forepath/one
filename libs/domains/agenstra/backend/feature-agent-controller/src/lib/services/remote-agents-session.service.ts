import { createCorrelationAwareSocketIoClient } from '@forepath/shared/backend/util-http-context';
import { AuthenticationType } from '@forepath/identity/backend';
import { ClientAgentCredentialsRepository } from '@forepath/identity/backend';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Socket as ClientSocket } from 'socket.io-client';

import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';

import { ClientsService } from './clients.service';
import { StatisticsService } from './statistics.service';

export interface RemoteChatSyncParams {
  clientId: string;
  agentId: string;
  message: string;
  correlationId: string;
  continue?: boolean;
  resumeSessionSuffix?: string;
  /** When set, records statistics under this kind instead of default chat. */
  statisticsInteractionKind?: StatisticsInteractionKind;
  /** Overrides `REMOTE_AGENT_CHAT_TIMEOUT_MS` for the agent response wait (e.g. shorter commit-message generation). */
  chatTimeoutMs?: number;
  contextInjection?: {
    includeWorkspace?: boolean;
    environmentIds?: string[];
    autoEnrichmentEnabled?: boolean;
  };
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

  private buildAgentsWsUrl(endpoint: string, overridePort?: number): string {
    const url = new URL(endpoint);
    const effectivePort = (overridePort && String(overridePort)) || process.env.CLIENTS_REMOTE_WS_PORT || '8080';
    const protocol = url.protocol === 'https:' ? 'https' : 'http';
    const host = url.hostname;

    return `${protocol}://${host}:${effectivePort}/agents`;
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

    return JSON.stringify(r);
  }

  /**
   * Connects to the remote agents gateway, logs in, sends one non-streaming `chat`, returns aggregated agent text.
   */
  async sendChatSync(params: RemoteChatSyncParams): Promise<string> {
    const client = await this.clientsRepository.findByIdOrThrow(params.clientId);
    const authHeader = await this.getAuthHeader(params.clientId);

    await validateClientEndpointWithDnsOrThrow(client.endpoint);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);
    const remoteUrl = this.buildAgentsWsUrl(client.endpoint, client.agentWsPort);
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

      const output = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const t = setTimeout(() => {
          if (!settled) {
            settled = true;
            remote.off('chatMessage', onChatMessage);
            reject(new BadRequestException('Timed out waiting for agent chat response'));
          }
        }, chatTimeoutMs);
        const onChatMessage = (msg: unknown) => {
          const text = this.extractAgentText(msg);

          if (text && !settled) {
            settled = true;
            clearTimeout(t);
            remote.off('chatMessage', onChatMessage);
            resolve(text);
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
        });
      });
      const outWords = output.trim().split(/\s+/).filter(Boolean).length;

      await this.statisticsService.recordChatOutput(
        params.clientId,
        params.agentId,
        outWords,
        output.length,
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
}
