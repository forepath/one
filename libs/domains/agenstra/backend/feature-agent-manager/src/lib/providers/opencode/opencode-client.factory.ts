import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { AgentsRepository } from '../../repositories/agents.repository';
import { DockerService } from '../../services/docker.service';
import { effectiveIsolationLevel, isMicrovmIsolationLevel } from '../../utils/container-isolation.utils';

import { OPENCODE_SERVER_PORT, OPENCODE_SERVER_USERNAME_DEFAULT } from './opencode-provider.config';
import type { CreateOpencodeClient, OpencodeClient } from './opencode-sdk.types';

interface CachedClient {
  client: OpencodeClient;
  baseUrl: string;
  password: string;
  containerId: string;
}

/**
 * How long a worker's OpenCode server may take to answer `/global/health` (create, start, restart, recreate) unless a
 * caller passes `timeoutMs`. MicroVM workers boot a guest kernel and desktop first; their cold start is measured in
 * seconds-to-minutes and grows with host load, so they get their own (env-overridable) limit.
 */
export const OPENCODE_HEALTH_TIMEOUT_MS_ENV = 'OPENCODE_HEALTH_TIMEOUT_MS';
export const OPENCODE_MICROVM_HEALTH_TIMEOUT_MS_ENV = 'OPENCODE_MICROVM_HEALTH_TIMEOUT_MS';
export const OPENCODE_HEALTH_TIMEOUT_MS_DEFAULT = 60_000;
export const OPENCODE_MICROVM_HEALTH_TIMEOUT_MS_DEFAULT = 600_000;

function timeoutFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);

  return Number.isFinite(value) && value >= 5_000 ? value : fallback;
}

/** Default health wait for a worker of the given (stored) isolation level. */
export function resolveOpencodeHealthTimeoutMs(isolationLevel: string | null | undefined): number {
  return isMicrovmIsolationLevel(effectiveIsolationLevel(isolationLevel))
    ? timeoutFromEnv(OPENCODE_MICROVM_HEALTH_TIMEOUT_MS_ENV, OPENCODE_MICROVM_HEALTH_TIMEOUT_MS_DEFAULT)
    : timeoutFromEnv(OPENCODE_HEALTH_TIMEOUT_MS_ENV, OPENCODE_HEALTH_TIMEOUT_MS_DEFAULT);
}

/**
 * Status OpenCode answers directory-instance routes with once the request that started the instance bootstrap was
 * cancelled mid-way: the interrupted bootstrap stays cached, so every route of the directory fails and every prompt
 * ends at once in `MessageAbortedError` until the instance is disposed. `/global/*` routes keep working, so the
 * health check does not notice. Cold microVM workers bootstrap slower than short-timeout calls (status probes) wait.
 */
export const OPENCODE_INTERRUPTED_INSTANCE_STATUS = 499;

/** The warm-up request owns the bootstrap and must not be cut short itself (cold microVM boots take tens of seconds). */
export const OPENCODE_INSTANCE_READY_TIMEOUT_MS = 300_000;

/** A verified instance is not checked again for this long. */
export const OPENCODE_INSTANCE_READY_TTL_MS = 60_000;

const OPENCODE_INSTANCE_DISPOSE_TIMEOUT_MS = 30_000;

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
  /** Running instance checks per `agentId:containerId` (concurrent callers share one). */
  private readonly instanceChecks = new Map<string, Promise<boolean>>();
  /** `agentId:containerId` → time until which the directory instance counts as verified. */
  private readonly instanceReadyUntil = new Map<string, number>();

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

    for (const key of this.instanceReadyUntil.keys()) {
      if (key.startsWith(`${agentId}:`)) {
        this.instanceReadyUntil.delete(key);
      }
    }
  }

  /**
   * Make sure the worker's directory instance is bootstrapped and usable before short-timeout calls or prompts reach
   * it: one request without a short timeout performs (or waits for) the bootstrap, and an instance stuck after an
   * interrupted bootstrap ({@link OPENCODE_INTERRUPTED_INSTANCE_STATUS}) is disposed and bootstrapped again.
   * Best effort: never throws; `false` when the instance could not be verified (callers continue as before).
   */
  ensureInstanceReady(
    agentId: string,
    containerId: string,
    connection?: { baseUrl: string; authorization: string },
  ): Promise<boolean> {
    const key = `${agentId}:${containerId}`;

    if ((this.instanceReadyUntil.get(key) ?? 0) > Date.now()) {
      return Promise.resolve(true);
    }

    let pending = this.instanceChecks.get(key);

    if (!pending) {
      pending = this.checkInstance(agentId, containerId, connection)
        .then((ready) => {
          if (ready) {
            this.instanceReadyUntil.set(key, Date.now() + OPENCODE_INSTANCE_READY_TTL_MS);
          } else {
            this.instanceReadyUntil.delete(key);
          }

          return ready;
        })
        .finally(() => this.instanceChecks.delete(key));
      this.instanceChecks.set(key, pending);
    }

    return pending;
  }

  private async checkInstance(
    agentId: string,
    containerId: string,
    connection?: { baseUrl: string; authorization: string },
  ): Promise<boolean> {
    try {
      const { baseUrl, authorization } = connection ?? (await this.resolveConnection(agentId, containerId));
      const base = baseUrl.replace(/\/$/, '');
      // `/mcp` is a directory-instance route (it bootstraps the instance) and also starts the MCP servers the first
      // prompt needs anyway.
      const probe = () =>
        fetch(`${base}/mcp`, {
          headers: { Authorization: authorization, Accept: 'application/json' },
          signal: AbortSignal.timeout(OPENCODE_INSTANCE_READY_TIMEOUT_MS),
        });
      let response = await probe();

      if (response.status === OPENCODE_INTERRUPTED_INSTANCE_STATUS) {
        await response.body?.cancel();
        this.logger.warn(`OpenCode instance of agent ${agentId} is stuck after an interrupted bootstrap; disposing it`);

        const disposed = await fetch(`${base}/instance/dispose`, {
          method: 'POST',
          headers: { Authorization: authorization, Accept: 'application/json' },
          signal: AbortSignal.timeout(OPENCODE_INSTANCE_DISPOSE_TIMEOUT_MS),
        });

        await disposed.body?.cancel();

        if (!disposed.ok) {
          this.logger.warn(`Disposing the OpenCode instance of agent ${agentId} failed (${disposed.status})`);

          return false;
        }

        response = await probe();

        if (response.ok) {
          this.logger.log(`OpenCode instance of agent ${agentId} recovered`);
        }
      }

      await response.body?.cancel();

      return response.ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.debug(`OpenCode instance check failed for agent ${agentId}: ${message}`);

      return false;
    }
  }

  async waitForHealthy(
    agentId: string,
    containerId: string,
    options: WaitForHealthyOptions | number = {},
  ): Promise<void> {
    // Backward-compatible overload: waitForHealthy(id, containerId, timeoutMs)
    const normalized: WaitForHealthyOptions = typeof options === 'number' ? { timeoutMs: options } : (options ?? {});
    const agent =
      normalized.password && normalized.timeoutMs !== undefined ? null : await this.agentsRepository.findById(agentId);
    const timeoutMs = normalized.timeoutMs ?? resolveOpencodeHealthTimeoutMs(agent?.isolationLevel);
    const startedAt = Date.now();

    const password = normalized.password ?? agent?.opencodeServerPassword;

    if (!password) {
      throw new ServiceUnavailableException(`OpenCode server password is not configured for agent ${agentId}`);
    }

    const username = process.env.OPENCODE_SERVER_USERNAME || OPENCODE_SERVER_USERNAME_DEFAULT;
    const authorization = this.basicAuthHeader(username, password);
    const deadline = Date.now() + timeoutMs;

    // A (re)started server has a fresh directory instance: verify it again.
    this.instanceReadyUntil.delete(`${agentId}:${containerId}`);
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
            // Logged (not debug): the time to healthy is what the isolation-level limits are sized from.
            this.logger.log(
              `OpenCode healthy for agent ${agentId} after ${Date.now() - startedAt} ms (limit ${timeoutMs} ms) at ${baseUrl}`,
            );
            // Bootstrap the directory instance right away (not awaited: lifecycle operations do not wait for it),
            // so it is owned by a request without a short timeout; prompts and status probes await the same check.
            void this.ensureInstanceReady(agentId, containerId, { baseUrl, authorization });

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

        // The container is gone (agent deleted or recreated meanwhile): it can never become healthy.
        if (error instanceof NotFoundException) {
          break;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const message = lastError instanceof Error ? lastError.message : 'Unknown health check error';
    const endpointHint = lastBaseUrl ? ` (last endpoint: ${lastBaseUrl})` : '';

    this.logger.error(
      `OpenCode health check failed for agent ${agentId} after ${Date.now() - startedAt} ms (limit ${timeoutMs} ms)` +
        `${endpointHint}: ${message}`,
    );

    throw new ServiceUnavailableException(`OpenCode server did not become healthy for agent ${agentId}: ${message}`);
  }
}
