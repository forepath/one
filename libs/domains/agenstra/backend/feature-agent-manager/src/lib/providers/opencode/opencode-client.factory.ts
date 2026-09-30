import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { AgentsRepository } from '../../repositories/agents.repository';
import { DockerService } from '../../services/docker.service';

import { OPENCODE_SERVER_PORT, OPENCODE_SERVER_USERNAME_DEFAULT } from './opencode-provider.config';
import type { CreateOpencodeClient, OpencodeClient } from './opencode-sdk.types';

interface CachedClient {
  client: OpencodeClient;
  baseUrl: string;
  password: string;
  containerId: string;
}

export interface WaitForHealthyOptions {
  /** Plaintext password (avoids a DB round-trip right after create). */
  password?: string;
  timeoutMs?: number;
}

/**
 * Builds and caches OpenCode HTTP clients per agent worker.
 * Uses dynamic import because `@opencode-ai/sdk` is ESM-only.
 */
@Injectable()
export class OpenCodeClientFactory {
  private readonly logger = new Logger(OpenCodeClientFactory.name);
  private readonly clients = new Map<string, CachedClient>();
  private createClientPromise: Promise<CreateOpencodeClient> | null = null;

  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly dockerService: DockerService,
  ) {}

  private loadCreateClient(): Promise<CreateOpencodeClient> {
    if (!this.createClientPromise) {
      // `@opencode-ai/sdk` is ESM-only (package.json exports.import only). Webpack must not rewrite
      // this to require(); webpackIgnore keeps a native dynamic import that Node can resolve.
      // Function-form is a belt-and-suspenders fallback if a bundler still rewrites import().
      const importEsm = new Function('specifier', 'return import(specifier)') as (
        specifier: string,
      ) => Promise<{ createOpencodeClient?: CreateOpencodeClient }>;

      this.createClientPromise = importEsm('@opencode-ai/sdk').then((mod) => {
        const create = mod.createOpencodeClient;

        if (!create) {
          throw new Error('@opencode-ai/sdk did not export createOpencodeClient');
        }

        return create;
      });
    }

    return this.createClientPromise;
  }

  private basicAuthHeader(username: string, password: string): string {
    return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
  }

  async resolveBaseUrl(containerId: string): Promise<string> {
    return this.dockerService.resolveContainerHttpBaseUrl(containerId, OPENCODE_SERVER_PORT);
  }

  /**
   * Resolves worker base URL + Basic auth for raw OpenCode HTTP calls.
   * Used for APIs missing from the v1 `@opencode-ai/sdk` client (e.g. question reply).
   */
  async resolveConnection(agentId: string, containerId: string): Promise<{ baseUrl: string; authorization: string }> {
    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }

    const password = agent.opencodeServerPassword;

    if (!password) {
      throw new Error(`OpenCode server password is not configured for agent ${agentId}`);
    }

    const baseUrl = await this.resolveBaseUrl(containerId);
    const username = process.env.OPENCODE_SERVER_USERNAME || OPENCODE_SERVER_USERNAME_DEFAULT;

    return {
      baseUrl,
      authorization: this.basicAuthHeader(username, password),
    };
  }

  async getClient(agentId: string, containerId: string): Promise<OpencodeClient> {
    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }

    const password = agent.opencodeServerPassword;

    if (!password) {
      throw new Error(`OpenCode server password is not configured for agent ${agentId}`);
    }

    const baseUrl = await this.resolveBaseUrl(containerId);
    const cached = this.clients.get(agentId);

    if (cached && cached.baseUrl === baseUrl && cached.password === password && cached.containerId === containerId) {
      return cached.client;
    }

    const createOpencodeClient = await this.loadCreateClient();
    const username = process.env.OPENCODE_SERVER_USERNAME || OPENCODE_SERVER_USERNAME_DEFAULT;
    const authorization = this.basicAuthHeader(username, password);

    const client = createOpencodeClient({
      baseUrl,
      headers: {
        Authorization: authorization,
      },
    });

    this.clients.set(agentId, { client, baseUrl, password, containerId });
    this.logger.debug(`Created OpenCode HTTP client for agent ${agentId} at ${baseUrl}`);

    return client;
  }

  invalidate(agentId: string): void {
    this.clients.delete(agentId);
  }

  async waitForHealthy(
    agentId: string,
    containerId: string,
    options: WaitForHealthyOptions | number = {},
  ): Promise<void> {
    // Backward-compatible overload: waitForHealthy(id, containerId, timeoutMs)
    const normalized: WaitForHealthyOptions = typeof options === 'number' ? { timeoutMs: options } : (options ?? {});
    const timeoutMs = normalized.timeoutMs ?? 60_000;

    let password = normalized.password;

    if (!password) {
      const agent = await this.agentsRepository.findById(agentId);

      password = agent?.opencodeServerPassword;
    }

    if (!password) {
      throw new ServiceUnavailableException(`OpenCode server password is not configured for agent ${agentId}`);
    }

    const username = process.env.OPENCODE_SERVER_USERNAME || OPENCODE_SERVER_USERNAME_DEFAULT;
    const authorization = this.basicAuthHeader(username, password);
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    let lastBaseUrl: string | undefined;

    while (Date.now() < deadline) {
      try {
        const baseUrl = await this.resolveBaseUrl(containerId);
        lastBaseUrl = baseUrl;
        const remainingMs = Math.max(1_000, deadline - Date.now());
        const response = await fetch(`${baseUrl}/global/health`, {
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(Math.min(5_000, remainingMs)),
        });

        if (response.ok) {
          const body = (await response.json()) as { healthy?: boolean };

          if (body.healthy) {
            this.logger.debug(`OpenCode health check passed for agent ${agentId} at ${baseUrl}`);

            return;
          }

          lastError = new Error(`Health payload missing healthy=true at ${baseUrl}`);
        } else if (response.status === 401 || response.status === 403) {
          lastError = new Error(`OpenCode health check unauthorized (${response.status}) at ${baseUrl}`);
        } else {
          lastError = new Error(`Unexpected health status ${response.status} at ${baseUrl}`);
        }
      } catch (error) {
        lastError = error;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const message = lastError instanceof Error ? lastError.message : 'Unknown health check error';
    const endpointHint = lastBaseUrl ? ` (last endpoint: ${lastBaseUrl})` : '';

    this.logger.error(`OpenCode health check failed for agent ${agentId}${endpointHint}: ${message}`);

    throw new ServiceUnavailableException(`OpenCode server did not become healthy for agent ${agentId}: ${message}`);
  }
}
