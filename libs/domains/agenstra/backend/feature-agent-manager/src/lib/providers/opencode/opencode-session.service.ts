import { Injectable, Logger } from '@nestjs/common';
import {
  AGENSTRA_AUTOMATION_AGENT_NAME,
  AGENSTRA_AUTOMATION_SESSION_PERMISSION_RULESET,
} from '@forepath/agenstra/shared/util-opencode-config';

import { isTicketAutomationResumeSessionSuffix } from '../../constants/chat-session.constants';
import { AgentsRepository } from '../../repositories/agents.repository';
import type { AgentProviderOptions } from '../agent-provider.interface';

import { OpenCodeClientFactory } from './opencode-client.factory';
import type { OpencodeClient, Session } from './opencode-sdk.types';

export interface OpenCodeSessionKey {
  agentId: string;
  containerId: string;
  resumeSessionSuffix?: string;
}

/**
 * Creates and persists OpenCode HTTP session ids (reuses `acp_sessions` jsonb).
 */
@Injectable()
export class OpenCodeSessionService {
  private readonly logger = new Logger(OpenCodeSessionService.name);

  constructor(
    private readonly clientFactory: OpenCodeClientFactory,
    private readonly agentsRepository: AgentsRepository,
  ) {}

  async getOrCreateSessionId(key: OpenCodeSessionKey, options?: AgentProviderOptions): Promise<string> {
    const client = await this.clientFactory.getClient(key.agentId, key.containerId);
    const knownSessionId = await this.agentsRepository.findPersistedAcpSessionId(
      key.agentId,
      key.containerId,
      key.resumeSessionSuffix ?? options?.resumeSessionSuffix,
    );

    if (knownSessionId) {
      try {
        const existing = await client.session.get({ path: { id: knownSessionId } });

        if (existing.data?.id) {
          return existing.data.id;
        }
      } catch (error) {
        const err = error as { message?: string };

        this.logger.debug(
          `Persisted OpenCode session ${knownSessionId} unavailable for agent ${key.agentId}: ${err.message}`,
        );
      }
    }

    const created = await this.createSession(client, key);

    await this.agentsRepository.saveAcpSession(
      key.agentId,
      key.containerId,
      created.id,
      key.resumeSessionSuffix ?? options?.resumeSessionSuffix,
    );

    return created.id;
  }

  private async createSession(client: OpencodeClient, key: OpenCodeSessionKey): Promise<Session> {
    const titleSuffix = key.resumeSessionSuffix ? ` (${key.resumeSessionSuffix})` : '';
    const automation = isTicketAutomationResumeSessionSuffix(key.resumeSessionSuffix);
    const result = await client.session.create({
      body: {
        title: `agenstra${titleSuffix}`,
        ...(automation
          ? {
              agent: AGENSTRA_AUTOMATION_AGENT_NAME,
              permission: [...AGENSTRA_AUTOMATION_SESSION_PERMISSION_RULESET],
            }
          : {}),
      },
    });

    if (!result.data?.id) {
      const message =
        result.error && typeof result.error === 'object' && 'message' in result.error
          ? String((result.error as { message?: unknown }).message)
          : 'Unknown OpenCode session create error';

      throw new Error(`OpenCode session creation failed: ${message}`);
    }

    return result.data;
  }

  async clearSession(key: OpenCodeSessionKey): Promise<void> {
    await this.agentsRepository.clearAcpSession(key.agentId, key.resumeSessionSuffix);
  }
}
