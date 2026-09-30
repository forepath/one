import {
  applySecretsPatch,
  assertNoCredentialKeysInConfig,
  extractNetworkSecrets,
  extractProviderEnvSecrets,
  isPemCertificateMaterial,
  resolveProviderAuthSecrets,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  AgentOpencodeConfigResponseDto,
  OpencodeAgentInfoDto,
  OpencodeAgentsListResponseDto,
  OpencodeCommandInfoDto,
  OpencodeCommandsListResponseDto,
  UpsertAgentOpencodeConfigDto,
} from '../../dto/agent-opencode-config.dto';
import { AgentsRepository } from '../../repositories/agents.repository';
import { DockerService } from '../../services/docker.service';

import { OpenCodeClientFactory } from './opencode-client.factory';
import type { OpenCodeAgentInfo } from './opencode-sdk.types';

const NETWORK_CA_CERT_RELATIVE_PATH = '.agenstra/extra-ca.pem';

export interface OpencodeSyncEffectiveResult {
  ok: boolean;
  /** Keep controller sync target pending (container missing / not ready). */
  defer?: boolean;
  error?: string;
}

function parseSecrets(raw: string | null | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const out: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        out[key] = value;
      }
    }

    return out;
  } catch {
    return {};
  }
}

function escapeForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Extract a readable message from OpenCode SDK / HTTP error payloads. */
function formatOpenCodeError(error: unknown): string {
  if (error == null) {
    return 'unknown error';
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;

    if (typeof record['message'] === 'string' && record['message'].trim()) {
      return record['message'];
    }

    const data = record['data'];

    if (data && typeof data === 'object') {
      const nested = data as Record<string, unknown>;

      if (typeof nested['message'] === 'string' && nested['message'].trim()) {
        return nested['message'];
      }
    }

    try {
      return JSON.stringify(error);
    } catch {
      return 'unknown error';
    }
  }

  return String(error);
}

/**
 * Persists per-agent OpenCode config and pushes effective config + secrets to the worker.
 * Provider credentials use auth.set plus Docker Env for provider `env` names
 * (e.g. AZURE_RESOURCE_NAME); network proxy/CA keys use Docker Env (recreate when changed).
 */
@Injectable()
export class OpenCodeConfigSyncService {
  private readonly logger = new Logger(OpenCodeConfigSyncService.name);

  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly clientFactory: OpenCodeClientFactory,
    private readonly dockerService: DockerService,
  ) {}

  async get(agentId: string): Promise<AgentOpencodeConfigResponseDto> {
    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }

    const secrets = parseSecrets(agent.opencodeUserSecrets);

    return {
      config: agent.opencodeUserConfig ?? {},
      overrides: agent.opencodeUserOverrides ?? {},
      secretKeys: Object.keys(secrets),
      updatedAt: agent.updatedAt,
    };
  }

  async put(agentId: string, dto: UpsertAgentOpencodeConfigDto): Promise<AgentOpencodeConfigResponseDto> {
    assertNoCredentialKeysInConfig(dto.config ?? undefined);
    assertNoCredentialKeysInConfig(dto.overrides ?? undefined);

    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }

    const patch: Partial<typeof agent> = {};

    if (dto.config !== undefined) {
      patch.opencodeUserConfig = dto.config;
    }

    if (dto.overrides !== undefined) {
      patch.opencodeUserOverrides = dto.overrides;
    }

    if (dto.secrets !== undefined) {
      const next = applySecretsPatch(parseSecrets(agent.opencodeUserSecrets), dto.secrets) ?? {};

      patch.opencodeUserSecrets = Object.keys(next).length ? JSON.stringify(next) : null;
    }

    const saved = await this.agentsRepository.update(agentId, patch);
    const secrets = parseSecrets(saved.opencodeUserSecrets);

    return {
      config: saved.opencodeUserConfig ?? {},
      overrides: saved.opencodeUserOverrides ?? {},
      secretKeys: Object.keys(secrets),
      updatedAt: saved.updatedAt,
    };
  }

  /**
   * Push effective config + secrets into the OpenCode worker.
   * Returns structured success/failure (never silent `{ ok: true }` on skip/error).
   */
  async syncEffective(
    agentId: string,
    effective: Record<string, unknown>,
    parentSecrets: Record<string, string> = {},
  ): Promise<OpencodeSyncEffectiveResult> {
    assertNoCredentialKeysInConfig(effective);

    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      return { ok: false, error: `Agent with ID '${agentId}' not found` };
    }

    if (!agent.containerId) {
      return { ok: false, defer: true, error: 'no running container' };
    }

    const agentSecrets = parseSecrets(agent.opencodeUserSecrets);
    // Agent-layer secrets win over workspace/global for the same key.
    const secrets = { ...parentSecrets, ...agentSecrets };

    try {
      const envResult = await this.applyEnvSecretsToContainer(agentId, agent.containerId, secrets, effective);

      if (!envResult.ok) {
        return envResult;
      }

      let containerId = envResult.containerId ?? agent.containerId;

      if (envResult.recreated) {
        this.clientFactory.invalidate(agentId);
        await this.clientFactory.waitForHealthy(agentId, containerId);
        const refreshed = await this.agentsRepository.findById(agentId);

        containerId = refreshed?.containerId ?? containerId;
      }

      const client = await this.clientFactory.getClient(agentId, containerId);
      const authSecrets = resolveProviderAuthSecrets(secrets, effective as Record<string, unknown>);

      for (const [providerId, auth] of Object.entries(authSecrets)) {
        if (!client.auth?.set || !auth.key) {
          continue;
        }

        const body: { type: 'api'; key: string; metadata?: Record<string, string> } = {
          type: 'api',
          key: auth.key,
        };

        if (auth.metadata && Object.keys(auth.metadata).length > 0) {
          body.metadata = auth.metadata;
        }

        const authResult = await client.auth.set({
          path: { id: providerId },
          body,
        });

        if (authResult.error) {
          const message = formatOpenCodeError(authResult.error);

          this.logger.warn(`OpenCode auth.set failed for ${agentId}/${providerId}: ${message}`);

          return { ok: false, error: `auth.set failed for ${providerId}: ${message}` };
        }
      }

      // Durable agent settings live in OpenCode global config (`~/.config/opencode`).
      // SDK `config.update` targets `/config` (project), which does not persist for workers.
      const { baseUrl, authorization } = await this.clientFactory.resolveConnection(agentId, containerId);
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/global/config`, {
        method: 'PATCH',
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(effective),
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        let message = bodyText || response.statusText || `HTTP ${response.status}`;

        try {
          const parsed = JSON.parse(bodyText) as unknown;

          message = formatOpenCodeError(parsed);
        } catch {
          // keep text body
        }

        this.logger.warn(`OpenCode config sync failed for ${agentId}: ${message}`);

        return { ok: false, error: message };
      }

      return { ok: true };
    } catch (error) {
      const message = formatOpenCodeError(error);

      this.logger.warn(`OpenCode config sync failed for ${agentId}: ${message}`);

      return { ok: false, error: message };
    }
  }

  /**
   * Apply network proxy/CA secrets and provider credential env vars via Docker Env.
   * Inline PEM CA material is written to a file; env points at that path.
   * Provider env names come from `providers`/`provider` `env` arrays (e.g. AZURE_RESOURCE_NAME).
   */
  private async applyEnvSecretsToContainer(
    agentId: string,
    containerId: string,
    secrets: Record<string, string>,
    effective: Record<string, unknown>,
  ): Promise<OpencodeSyncEffectiveResult & { containerId?: string; recreated?: boolean }> {
    const network = extractNetworkSecrets(secrets);
    const providerEnv = extractProviderEnvSecrets(secrets, effective as Record<string, unknown>);
    const desiredEnv: Record<string, string | undefined> = {
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      NO_PROXY: undefined,
      NODE_EXTRA_CA_CERTS: undefined,
    };

    for (const key of providerEnv.managedKeys) {
      desiredEnv[key] = undefined;
    }

    for (const [key, value] of Object.entries(network)) {
      desiredEnv[key] = value;
    }

    for (const [key, value] of Object.entries(providerEnv.values)) {
      desiredEnv[key] = value;
    }

    if (desiredEnv.NODE_EXTRA_CA_CERTS && isPemCertificateMaterial(desiredEnv.NODE_EXTRA_CA_CERTS)) {
      try {
        const home = await this.dockerService.getContainerHomeDirectory(containerId);
        const certPath = `${home.replace(/\/$/, '')}/${NETWORK_CA_CERT_RELATIVE_PATH}`;
        const certDir = certPath.slice(0, certPath.lastIndexOf('/'));
        const pem = desiredEnv.NODE_EXTRA_CA_CERTS;
        const base64Content = Buffer.from(pem, 'utf-8').toString('base64');

        await this.dockerService.sendCommandToContainer(containerId, `mkdir -p ${escapeForShell(certDir)}`);
        await this.dockerService.sendCommandToContainer(
          containerId,
          `echo ${escapeForShell(base64Content)} | base64 -d > ${escapeForShell(certPath)}`,
        );
        desiredEnv.NODE_EXTRA_CA_CERTS = certPath;
      } catch (error: unknown) {
        const err = error as { message?: string };

        return { ok: false, error: `Failed to write CA cert: ${err.message ?? 'unknown'}` };
      }
    }

    const currentEnv = await this.dockerService.getContainerEnvironmentMap(containerId);
    let changed = false;

    for (const key of Object.keys(desiredEnv)) {
      const next = desiredEnv[key];
      const current = currentEnv[key];

      if (next === undefined) {
        if (current !== undefined) {
          changed = true;
        }
      } else if (current !== next) {
        changed = true;
      }
    }

    if (!changed) {
      return { ok: true, containerId, recreated: false };
    }

    try {
      const newContainerId = await this.dockerService.updateContainer(containerId, { env: desiredEnv });

      await this.agentsRepository.update(agentId, { containerId: newContainerId });
      this.logger.log(`Applied env secrets for agent ${agentId} (container ${containerId} -> ${newContainerId})`);

      return { ok: true, containerId: newContainerId, recreated: true };
    } catch (error: unknown) {
      const err = error as { message?: string };

      return { ok: false, error: `Failed to apply env secrets: ${err.message ?? 'unknown'}` };
    }
  }

  /**
   * Lists slash-invokable commands from the running OpenCode worker (`GET /command`).
   * Includes config commands, built-ins (`init`, `review`), discovered skills, and MCP prompts.
   */
  async listCommands(agentId: string): Promise<OpencodeCommandsListResponseDto> {
    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }

    if (!agent.containerId) {
      return { commands: [] };
    }

    const { baseUrl, authorization } = await this.clientFactory.resolveConnection(agentId, agent.containerId);
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/command`, {
      method: 'GET',
      headers: { Authorization: authorization, Accept: 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');

      throw new Error(`Failed to list OpenCode commands (${response.status}): ${body || response.statusText}`);
    }

    const data = (await response.json()) as unknown;
    const rows = Array.isArray(data) ? data : [];
    const commands: OpencodeCommandInfoDto[] = [];

    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        continue;
      }

      const entry = row as Record<string, unknown>;
      const name = typeof entry['name'] === 'string' ? entry['name'].trim() : '';

      if (!name) {
        continue;
      }

      const rawSource = entry['source'];
      const source = rawSource === 'command' || rawSource === 'mcp' || rawSource === 'skill' ? rawSource : undefined;

      commands.push({
        name,
        description: typeof entry['description'] === 'string' ? entry['description'] : undefined,
        agent: typeof entry['agent'] === 'string' ? entry['agent'] : undefined,
        model: typeof entry['model'] === 'string' ? entry['model'] : undefined,
        subtask: entry['subtask'] === true || entry['subagent'] === true,
        source,
      });
    }

    commands.sort((a, b) => a.name.localeCompare(b.name));

    return { commands };
  }

  /**
   * Lists effective OpenCode agents (primary + subagents) from the running worker.
   */
  async listAgents(agentId: string): Promise<OpencodeAgentsListResponseDto> {
    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }

    if (!agent.containerId) {
      return { agents: [] };
    }

    const client = await this.clientFactory.getClient(agentId, agent.containerId);

    if (!client.app?.agents) {
      this.logger.debug(`OpenCode client for ${agentId} has no app.agents; returning empty list`);

      return { agents: [] };
    }

    const result = await client.app.agents();

    if (result.error) {
      const err = result.error as { message?: string };

      throw new Error(err.message ?? 'Failed to list OpenCode agents');
    }

    const agents = (result.data ?? []).map(
      (item: OpenCodeAgentInfo): OpencodeAgentInfoDto => ({
        name: item.name,
        description: item.description,
        mode: item.mode,
        builtIn: item.builtIn,
        prompt: item.prompt,
        model: item.model,
        temperature: item.temperature,
        color: item.color,
      }),
    );

    return { agents };
  }
}
