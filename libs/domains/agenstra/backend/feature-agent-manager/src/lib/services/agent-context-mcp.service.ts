import {
  AGENSTRA_CONTEXT_MCP_SERVER_KEY,
  type PlatformContextMcpWireOptions,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger } from '@nestjs/common';

import {
  AGENT_CONTEXT_MCP_ENABLED_ENV,
  AGENT_CONTEXT_MCP_MANAGER_URL_ENV,
  AGENT_CONTEXT_MCP_STATUS_CACHE_TTL_MS,
} from '../constants/agent-context.constants';
import { OpenCodeClientFactory } from '../providers/opencode/opencode-client.factory';
import { AgentsRepository } from '../repositories/agents.repository';
import { AgentRuntime } from '../runtime/agent-runtime';
import {
  agentContextTokensEqual,
  deriveAgentContextToken,
  resolveAgentContextTokenSecret,
} from '../utils/agent-context-token.utils';

/** Worker image label advertising the bundled context MCP server (`Dockerfile.worker`). */
export const AGENT_CONTEXT_MCP_IMAGE_LABEL = 'io.agenstra.context-mcp';

/**
 * Decides per agent whether prompt context is served through the worker `agenstra` MCP server
 * or (fallback, unchanged behaviour) inlined into the prompt. MCP mode requires all of:
 * manager URL + token secret configured, a worker image shipping the server, and the server
 * reported `connected` by OpenCode.
 */
@Injectable()
export class AgentContextMcpService {
  private readonly logger = new Logger(AgentContextMcpService.name);
  private readonly statusCache = new Map<string, { connected: boolean; expiresAt: number }>();

  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly runtime: AgentRuntime,
    private readonly clientFactory: OpenCodeClientFactory,
  ) {}

  /** Manager base URL as seen from workers (no trailing slash), or `null` when disabled. */
  managerApiUrl(): string | null {
    if (process.env[AGENT_CONTEXT_MCP_ENABLED_ENV]?.trim().toLowerCase() === 'false') {
      return null;
    }

    const raw = process.env[AGENT_CONTEXT_MCP_MANAGER_URL_ENV]?.trim();

    if (!raw) {
      return null;
    }

    try {
      const url = new URL(raw);

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return null;
      }

      return raw.replace(/\/+$/, '');
    } catch {
      this.logger.warn(`Ignoring invalid ${AGENT_CONTEXT_MCP_MANAGER_URL_ENV}: ${raw}`);

      return null;
    }
  }

  isConfigured(): boolean {
    return this.managerApiUrl() !== null && resolveAgentContextTokenSecret() !== null;
  }

  async tokenFor(agentId: string): Promise<string | null> {
    const secret = resolveAgentContextTokenSecret();

    if (!secret) {
      return null;
    }

    const agent = await this.agentsRepository.findById(agentId);

    return agent ? deriveAgentContextToken(secret, agent.id, agent.hashedPassword) : null;
  }

  async verifyAgentToken(agentId: string, token: string): Promise<boolean> {
    if (!this.isConfigured() || !token) {
      return false;
    }

    const expected = await this.tokenFor(agentId);

    return expected !== null && agentContextTokensEqual(expected, token);
  }

  /** MCP wire options for config sync, or `null` when the worker cannot run the server. */
  async buildWireOptions(agentId: string, containerId: string): Promise<PlatformContextMcpWireOptions | null> {
    const apiUrl = this.managerApiUrl();

    if (!apiUrl) {
      return null;
    }

    const summary = await this.runtime.inspectContainerSummary(containerId).catch(() => null);

    if (summary?.labels?.[AGENT_CONTEXT_MCP_IMAGE_LABEL] !== '1') {
      return null;
    }

    const agentToken = await this.tokenFor(agentId);

    return agentToken ? { apiUrl, agentId, agentToken } : null;
  }

  /** True when OpenCode reports the platform server as connected (cached briefly). */
  async isAvailable(agentId: string, containerId: string): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    const cached = this.statusCache.get(agentId);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.connected;
    }

    let connected = false;

    try {
      const { baseUrl, authorization } = await this.clientFactory.resolveConnection(agentId, containerId);
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/mcp`, {
        method: 'GET',
        headers: { Authorization: authorization, Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });

      if (response.ok) {
        const body = (await response.json()) as Record<string, { status?: unknown } | undefined>;

        connected = body?.[AGENSTRA_CONTEXT_MCP_SERVER_KEY]?.status === 'connected';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.debug(`Context MCP status probe failed for agent ${agentId}: ${message}`);
    }

    this.statusCache.set(agentId, { connected, expiresAt: Date.now() + AGENT_CONTEXT_MCP_STATUS_CACHE_TTL_MS });

    return connected;
  }

  invalidate(agentId: string): void {
    this.statusCache.delete(agentId);
  }
}
