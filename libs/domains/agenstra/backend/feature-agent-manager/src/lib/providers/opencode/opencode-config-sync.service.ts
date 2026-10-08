import {
  applySecretsPatch,
  assertNoCredentialKeysInConfig,
  buildAllowDenyContext,
  composeLayerOverlay,
  enforceAllowDenyOnOverlay,
  extractMcpEnvSecrets,
  extractNetworkSecrets,
  extractProviderEnvSecrets,
  applyMcpRemovalTombstones,
  injectMcpSecretsIntoWire,
  isPemCertificateMaterial,
  migrateConfigV1ToV2,
  prepareConfigForSync,
  resolveProviderAuthSecrets,
  AGENSTRA_TICKET_AUTOMATION_SKILL_ABS_DIR,
  AGENSTRA_TICKET_AUTOMATION_SKILL_MD,
  type JsonObject,
} from '@forepath/agenstra/shared/util-opencode-config';
import { mcpServerConfigKey } from '@forepath/agenstra/shared/util-opencode-mcp-servers';
import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';

import {
  AgentOpencodeConfigResponseDto,
  OpencodeAgentInfoDto,
  OpencodeAgentsListResponseDto,
  OpencodeCommandInfoDto,
  OpencodeCommandsListResponseDto,
  OpencodeMcpAuthStartResponseDto,
  OpencodeMcpServerStatusDto,
  OpencodeMcpStatusListResponseDto,
  UpsertAgentOpencodeConfigDto,
} from '../../dto/agent-opencode-config.dto';
import { AgentsRepository } from '../../repositories/agents.repository';
import { DockerService } from '../../services/docker.service';
import {
  CONFIG_SYNC_ENVIRONMENT_PROGRESS_STEPS,
  EnvironmentProgressService,
  EnvironmentProgressTracker,
} from '../../services/environment-progress.service';

import { OpenCodeClientFactory } from './opencode-client.factory';
import type { OpenCodeAgentInfo } from './opencode-sdk.types';

const NETWORK_CA_CERT_RELATIVE_PATH = '.agenstra/extra-ca.pem';

/** Carries the progress tracker of a container recreation triggered during config sync. */
interface ConfigSyncProgressRef {
  agentName?: string;
  tracker?: EnvironmentProgressTracker;
}

export interface OpencodeSyncEffectiveResult {
  ok: boolean;
  /** Keep controller sync target pending (container missing / not ready). */
  defer?: boolean;
  error?: string;
}

function isPlainJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Manager has no MCP catalog DB: drop `registry` when the map key does not match
 * {@link mcpServerConfigKey}(registry). Controller sync re-verifies transport against the catalog.
 */
function stripMismatchedMcpRegistryClaims(overlay: JsonObject | null | undefined): JsonObject {
  const config = migrateConfigV1ToV2(overlay ?? {});
  const mcp = isPlainJsonObject(config['mcp']) ? { ...(config['mcp'] as JsonObject) } : null;

  if (!mcp || !isPlainJsonObject(mcp['servers'])) {
    return config;
  }

  const servers = { ...(mcp['servers'] as JsonObject) };
  let changed = false;

  for (const [key, value] of Object.entries(servers)) {
    if (!isPlainJsonObject(value)) {
      continue;
    }

    const entry = { ...value };
    const registry = typeof entry['registry'] === 'string' ? entry['registry'].trim() : '';

    if (!registry || mcpServerConfigKey(registry) === key.trim()) {
      continue;
    }

    delete entry['registry'];
    servers[key] = entry;
    changed = true;
  }

  if (!changed) {
    return config;
  }

  mcp['servers'] = servers;
  config['mcp'] = mcp;

  return config;
}

/**
 * Remove every MCP `registry` claim (nested or flat wire). Used before manager /sync prepare so
 * catalog identity cannot be asserted without controller catalog verification.
 */
function stripAllMcpRegistryClaims(overlay: JsonObject | null | undefined): JsonObject {
  const config = structuredClone(migrateConfigV1ToV2(overlay ?? {}));
  const mcp = config['mcp'];

  if (!isPlainJsonObject(mcp)) {
    return config;
  }

  if (isPlainJsonObject(mcp['servers'])) {
    const servers = { ...(mcp['servers'] as JsonObject) };

    for (const [key, value] of Object.entries(servers)) {
      if (!isPlainJsonObject(value) || value['registry'] === undefined) {
        continue;
      }

      const entry = { ...value };
      delete entry['registry'];
      servers[key] = entry;
    }

    mcp['servers'] = servers;
    config['mcp'] = mcp;

    return config;
  }

  // Flat OpenCode wire shape under mcp.
  const nextMcp: JsonObject = {};

  for (const [key, value] of Object.entries(mcp)) {
    if (!isPlainJsonObject(value)) {
      nextMcp[key] = value;
      continue;
    }

    const entry = { ...value };
    delete entry['registry'];
    nextMcp[key] = entry;
  }

  config['mcp'] = nextMcp;

  return config;
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
 * (e.g. AZURE_RESOURCE_NAME); MCP secretEnv names use Docker Env; network proxy/CA
 * keys use Docker Env (recreate when changed). MCP secret values are also merged into
 * wire `mcp` environment/headers before PATCH.
 */
@Injectable()
export class OpenCodeConfigSyncService {
  private readonly logger = new Logger(OpenCodeConfigSyncService.name);
  private configSyncedBroadcaster?: (agentId: string) => void;

  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly clientFactory: OpenCodeClientFactory,
    private readonly dockerService: DockerService,
    @Optional()
    private readonly environmentProgress?: EnvironmentProgressService,
  ) {}

  registerConfigSyncedBroadcaster(broadcaster: (agentId: string) => void): void {
    this.configSyncedBroadcaster = broadcaster;
  }

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

    // Defense in depth when called without controller parents: heal stored overlays too,
    // strip mismatched registry claims, then enforce against this layer's allow/deny lists.
    const nextConfig = stripMismatchedMcpRegistryClaims(
      dto.config !== undefined ? (dto.config as JsonObject) : ((agent.opencodeUserConfig as JsonObject) ?? {}),
    );
    const nextOverrides = stripMismatchedMcpRegistryClaims(
      dto.overrides !== undefined ? (dto.overrides as JsonObject) : ((agent.opencodeUserOverrides as JsonObject) ?? {}),
    );
    const composed = composeLayerOverlay(nextConfig, nextOverrides);
    const context = buildAllowDenyContext(composed, []);
    const sanitizedConfig = enforceAllowDenyOnOverlay(nextConfig, context, {
      seedMissingInheritedDisables: true,
    });
    const sanitizedOverrides = enforceAllowDenyOnOverlay(nextOverrides, context, {
      seedMissingInheritedDisables: false,
    });

    const patch: Partial<typeof agent> = {
      opencodeUserConfig: sanitizedConfig,
      opencodeUserOverrides: sanitizedOverrides,
    };

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
    const progressRef: ConfigSyncProgressRef = {};

    try {
      const result = await this.syncEffectiveInternal(agentId, effective, parentSecrets, progressRef);

      if (result.ok) {
        progressRef.tracker?.complete();
        this.configSyncedBroadcaster?.(agentId);
      } else {
        progressRef.tracker?.fail(result.error ?? 'OpenCode config sync failed');
      }

      return result;
    } catch (error) {
      progressRef.tracker?.fail(error);

      throw error;
    }
  }

  private async syncEffectiveInternal(
    agentId: string,
    effective: Record<string, unknown>,
    parentSecrets: Record<string, string>,
    progressRef: ConfigSyncProgressRef,
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

    // Prepare once and reuse for container Env, auth.set, and OpenCode PATCH so allow/deny
    // filtering applies before any container-side side effects.
    // Strip registry first: manager has no catalog, so catalog identity is fail-closed here.
    // Controller mergeEffectiveForSync already verified transports before sending wire payloads.
    const prepared = prepareConfigForSync(stripAllMcpRegistryClaims(effective as JsonObject));

    try {
      progressRef.agentName = agent.name;
      const envResult = await this.applyEnvSecretsToContainer(
        agentId,
        agent.containerId,
        secrets,
        prepared,
        progressRef,
      );

      if (!envResult.ok) {
        return envResult;
      }

      let containerId = envResult.containerId ?? agent.containerId;

      if (envResult.recreated) {
        this.clientFactory.invalidate(agentId);
        progressRef.tracker?.advance('waitingForHealthy');
        await this.clientFactory.waitForHealthy(agentId, containerId);
        progressRef.tracker?.advance('finalizing');
        const refreshed = await this.agentsRepository.findById(agentId);

        containerId = refreshed?.containerId ?? containerId;
      }

      await this.ensurePlatformAutomationSkillFiles(containerId);

      const client = await this.clientFactory.getClient(agentId, containerId);
      const authSecrets = resolveProviderAuthSecrets(secrets, prepared);

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
      // Inject MCP secrets after assert so stored overlays never hold credential-like keys.
      // PATCH merges mcp keys and rejects null deletes — tombstone removed servers with { enabled: false }.
      const wireConfig = injectMcpSecretsIntoWire(structuredClone(prepared) as JsonObject, secrets) as JsonObject;
      const currentGlobal = await this.fetchOpenCodeJson<Record<string, unknown>>(
        agentId,
        containerId,
        '/global/config',
        {
          method: 'GET',
        },
      );
      const currentMcp =
        currentGlobal?.['mcp'] && typeof currentGlobal['mcp'] === 'object' && !Array.isArray(currentGlobal['mcp'])
          ? (currentGlobal['mcp'] as JsonObject)
          : null;
      const reconciledWire = applyMcpRemovalTombstones(wireConfig, currentMcp);
      const { baseUrl, authorization } = await this.clientFactory.resolveConnection(agentId, containerId);
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/global/config`, {
        method: 'PATCH',
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reconciledWire),
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

  /** Install the platform ticket-automation skill so OpenCode can load it regardless of UI overlays. */
  private async ensurePlatformAutomationSkillFiles(containerId: string): Promise<void> {
    const dir = AGENSTRA_TICKET_AUTOMATION_SKILL_ABS_DIR;
    const filePath = `${dir}/SKILL.md`;
    const base64 = Buffer.from(AGENSTRA_TICKET_AUTOMATION_SKILL_MD, 'utf8').toString('base64');

    // Validate ancestors top-down before touching the formerly worker-owned skill directory.
    // Once its parent is trusted, taking ownership and atomically replacing the file cannot follow worker links.
    await this.dockerService.sendCommandToContainer(
      containerId,
      [
        '/usr/bin/env',
        '-i',
        'PATH=/usr/bin:/bin',
        '/bin/sh',
        '-c',
        `set -eu
for parent in /opt /opt/agenstra /opt/agenstra/skills; do
  if [ -L "$parent" ]; then
    printf 'Unsafe platform skill ancestor: %s\\n' "$parent" >&2
    exit 1
  fi
  if [ ! -e "$parent" ]; then
    mkdir -m 755 -- "$parent"
  fi
  owner=$(stat -c %u -- "$parent")
  mode=$(stat -c %a -- "$parent")
  if [ ! -d "$parent" ] || [ "$owner" != 0 ] || [ "$((0$mode & 022))" -ne 0 ]; then
    printf 'Untrusted platform skill ancestor: %s\\n' "$parent" >&2
    exit 1
  fi
done
dir=${JSON.stringify(dir)}
if [ -L "$dir" ] || { [ -e "$dir" ] && [ ! -d "$dir" ]; }; then
  printf 'Unsafe platform skill directory: %s\\n' "$dir" >&2
  exit 1
fi
install -d -m 755 -o root -g root -- "$dir"
tmp=$(mktemp "$dir/.SKILL.md.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT
printf '%s' ${JSON.stringify(base64)} | base64 -d > "$tmp"
chmod 644 -- "$tmp"
mv -fT -- "$tmp" ${JSON.stringify(filePath)}`,
      ],
      undefined,
      true,
      { user: '0' },
    );
  }

  /**
   * Apply network proxy/CA secrets, provider credential env vars, and MCP secretEnv
   * via Docker Env. Inline PEM CA material is written to a file; env points at that path.
   * Provider env names come from `providers`/`provider` `env` arrays (e.g. AZURE_RESOURCE_NAME).
   * MCP env names come from `mcp`/`mcp.servers` `secretEnv` arrays.
   */
  private async applyEnvSecretsToContainer(
    agentId: string,
    containerId: string,
    secrets: Record<string, string>,
    effective: Record<string, unknown>,
    progressRef: ConfigSyncProgressRef = {},
  ): Promise<OpencodeSyncEffectiveResult & { containerId?: string; recreated?: boolean }> {
    const network = extractNetworkSecrets(secrets);
    const providerEnv = extractProviderEnvSecrets(secrets, effective as Record<string, unknown>);
    const mcpEnv = extractMcpEnvSecrets(secrets, effective as Record<string, unknown>);
    const desiredEnv: Record<string, string | undefined> = {
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      NO_PROXY: undefined,
      NODE_EXTRA_CA_CERTS: undefined,
    };

    for (const key of providerEnv.managedKeys) {
      desiredEnv[key] = undefined;
    }

    for (const key of mcpEnv.managedKeys) {
      desiredEnv[key] = undefined;
    }

    for (const [key, value] of Object.entries(network)) {
      desiredEnv[key] = value;
    }

    for (const [key, value] of Object.entries(providerEnv.values)) {
      desiredEnv[key] = value;
    }

    for (const [key, value] of Object.entries(mcpEnv.values)) {
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
      progressRef.tracker = this.environmentProgress?.start({
        agentId,
        agentName: progressRef.agentName ?? agentId,
        operation: 'update',
        steps: CONFIG_SYNC_ENVIRONMENT_PROGRESS_STEPS,
      });
      progressRef.tracker?.advance('recreatingContainer');
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
   * Lists live MCP server statuses from the running OpenCode worker (`GET /mcp`).
   * Statuses include `needs_auth` / `needs_client_registration` for interactive OAuth.
   */
  async listMcpStatuses(agentId: string): Promise<OpencodeMcpStatusListResponseDto> {
    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }

    if (!agent.containerId) {
      return { servers: [] };
    }

    const data = await this.fetchOpenCodeJson<Record<string, unknown>>(agentId, agent.containerId, '/mcp', {
      method: 'GET',
    });

    return { servers: this.mapMcpStatusRecord(data) };
  }

  /**
   * Starts MCP OAuth (`POST /mcp/{name}/auth`). Returns a browser authorization URL.
   * When `redirectUri` is provided, patches OpenCode MCP oauth.redirectUri first so the IdP
   * returns to the controller public callback (not 127.0.0.1:19876 inside Docker).
   */
  async startMcpAuth(agentId: string, name: string, redirectUri?: string): Promise<OpencodeMcpAuthStartResponseDto> {
    const { containerId } = await this.requireRunningAgent(agentId);

    if (redirectUri?.trim()) {
      await this.patchMcpOAuthRedirectUri(agentId, containerId, name, redirectUri.trim());
    }

    const encoded = encodeURIComponent(name);
    const data = await this.fetchOpenCodeJson<{ authorizationUrl?: string; oauthState?: string }>(
      agentId,
      containerId,
      `/mcp/${encoded}/auth`,
      { method: 'POST' },
    );

    const authorizationUrl = typeof data.authorizationUrl === 'string' ? data.authorizationUrl.trim() : '';

    if (!authorizationUrl) {
      throw new BadRequestException('OpenCode did not return an MCP authorization URL');
    }

    return {
      authorizationUrl,
      oauthState: typeof data.oauthState === 'string' ? data.oauthState : undefined,
    };
  }

  /**
   * Ensure OpenCode MCP remote oauth.redirectUri points at the Agenstra public callback
   * before auth.start (OpenCode embeds this in the authorization request).
   */
  private async patchMcpOAuthRedirectUri(
    agentId: string,
    containerId: string,
    name: string,
    redirectUri: string,
  ): Promise<void> {
    const current = await this.fetchOpenCodeJson<Record<string, unknown>>(agentId, containerId, '/global/config', {
      method: 'GET',
    });
    const mcpRaw = current?.['mcp'];
    const mcp =
      mcpRaw && typeof mcpRaw === 'object' && !Array.isArray(mcpRaw) ? { ...(mcpRaw as Record<string, unknown>) } : {};
    const existing = mcp[name];

    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      throw new BadRequestException(`MCP server '${name}' is not present in the OpenCode worker config`);
    }

    const entry = { ...(existing as Record<string, unknown>) };
    const oauthRaw = entry['oauth'];
    const oauth =
      oauthRaw && typeof oauthRaw === 'object' && !Array.isArray(oauthRaw)
        ? { ...(oauthRaw as Record<string, unknown>) }
        : {};

    oauth['redirectUri'] = redirectUri;
    entry['oauth'] = oauth;
    mcp[name] = entry;

    await this.fetchOpenCodeJson(agentId, containerId, '/global/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcp }),
    });
  }

  /**
   * Completes MCP OAuth with the authorization code (`POST /mcp/{name}/auth/callback`).
   */
  async completeMcpAuth(agentId: string, name: string, code: string): Promise<OpencodeMcpServerStatusDto> {
    const { containerId } = await this.requireRunningAgent(agentId);
    const encoded = encodeURIComponent(name);
    const data = await this.fetchOpenCodeJson<Record<string, unknown>>(
      agentId,
      containerId,
      `/mcp/${encoded}/auth/callback`,
      {
        method: 'POST',
        body: JSON.stringify({ code }),
        headers: { 'Content-Type': 'application/json' },
      },
    );

    return this.mapSingleMcpStatus(name, data);
  }

  /**
   * Removes stored MCP OAuth credentials (`DELETE /mcp/{name}/auth`).
   */
  async removeMcpAuth(agentId: string, name: string): Promise<{ success: true }> {
    const { containerId } = await this.requireRunningAgent(agentId);
    const encoded = encodeURIComponent(name);

    await this.fetchOpenCodeJson<unknown>(agentId, containerId, `/mcp/${encoded}/auth`, {
      method: 'DELETE',
    });

    return { success: true };
  }

  private async requireRunningAgent(agentId: string): Promise<{ containerId: string }> {
    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }

    if (!agent.containerId) {
      throw new BadRequestException(`Agent '${agentId}' is not running`);
    }

    return { containerId: agent.containerId };
  }

  private async fetchOpenCodeJson<T>(
    agentId: string,
    containerId: string,
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const { baseUrl, authorization } = await this.clientFactory.resolveConnection(agentId, containerId);
    const headers = new Headers(init.headers);
    headers.set('Authorization', authorization);
    headers.set('Accept', 'application/json');

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const detail = body || response.statusText;

      throw new BadRequestException(`OpenCode MCP request failed (${response.status}): ${detail}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text().catch(() => '');

    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  private mapMcpStatusRecord(data: Record<string, unknown> | null | undefined): OpencodeMcpServerStatusDto[] {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return [];
    }

    const servers: OpencodeMcpServerStatusDto[] = [];

    for (const [name, raw] of Object.entries(data)) {
      if (!name.trim()) {
        continue;
      }

      servers.push(this.mapSingleMcpStatus(name, raw));
    }

    servers.sort((a, b) => a.name.localeCompare(b.name));

    return servers;
  }

  private mapSingleMcpStatus(name: string, raw: unknown): OpencodeMcpServerStatusDto {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { name, status: 'failed', error: 'Invalid MCP status payload' };
    }

    const entry = raw as Record<string, unknown>;
    const status = entry['status'];

    if (
      status === 'connected' ||
      status === 'disabled' ||
      status === 'failed' ||
      status === 'needs_auth' ||
      status === 'needs_client_registration'
    ) {
      return {
        name,
        status,
        error: typeof entry['error'] === 'string' ? entry['error'] : undefined,
      };
    }

    return {
      name,
      status: 'failed',
      error: typeof entry['error'] === 'string' ? entry['error'] : `Unknown MCP status: ${String(status)}`,
    };
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
