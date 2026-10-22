import type { AgentTypeCapabilities } from '../agents/agents.types';

// Types based on OpenAPI spec
export type ClientAuthenticationType = 'api_key' | 'keycloak';

export interface AgentTypeInfo {
  type: string;
  displayName: string;
  capabilities: AgentTypeCapabilities;
}

/**
 * Container isolation level of an environment:
 * `microvm` = KVM microVM with its own guest kernel (launcher container on `runc`),
 * `sandboxed-kvm` = gVisor on its KVM platform (`runsc-kvm`, hardware virtualization),
 * `sandboxed` = gVisor (`runsc-systrap`), `standard` = Docker's default runtime (`runc`).
 */
export type IsolationLevel = 'standard' | 'sandboxed' | 'sandboxed-kvm' | 'microvm';

/** Runtime state of an isolation level on a workspace host (derived from real runtime probes). */
export type IsolationRuntimeState =
  | 'ready'
  | 'unsupported'
  | 'installation-failed'
  | 'probe-failed'
  | 'disabled-by-admin';

export interface IsolationLevelCapabilityDto {
  /** Strength rank (`1` = standard, `2` = sandboxed, `3` = sandboxed-kvm, `4` = microvm). */
  rank: number;
  /** Docker runtime name used for this level (`runc`, `runsc-systrap`, `runsc-kvm`). */
  runtime: string;
  state: IsolationRuntimeState;
  /** Stable machine-readable reason when the level is not `ready`. */
  reasonCode?: string | null;
  /** Short operator-facing explanation. */
  reason?: string | null;
}

export interface IsolationLevelsDto {
  standard: IsolationLevelCapabilityDto;
  sandboxed: IsolationLevelCapabilityDto;
  /** Optional: agent controllers that predate the level do not report it. */
  'sandboxed-kvm'?: IsolationLevelCapabilityDto;
  /** Optional: agent controllers that predate the level do not report it. */
  microvm?: IsolationLevelCapabilityDto;
}

/** Raw isolation capability record reported by the agent manager (`config.isolation`). */
export interface HostIsolationCapabilitiesDto {
  revision: string;
  probedAt: string | null;
  probing: boolean;
  levels: IsolationLevelsDto;
  recommendedLevel: IsolationLevel | null;
  availableLevels: IsolationLevel[];
}

/** Container isolation summary of a workspace host (`GET /clients/:id/isolation`). */
export interface ClientIsolationSummaryDto {
  /** False when the agent manager predates isolation levels (standard Docker only). */
  supported: boolean;
  /** Strongest ready level (preselected for new environments); `null` when the host cannot run environments. */
  recommendedLevel: IsolationLevel | null;
  /** Ready levels, strongest first. */
  availableLevels: IsolationLevel[];
  levels: IsolationLevelsDto;
  /** Capability revision to submit with environment creation (stale selections are rejected). */
  revision: string | null;
  probedAt: string | null;
  probing: boolean;
  /** True when served from the last stored snapshot because the agent manager was unreachable. */
  stale: boolean;
}

export interface ConfigResponseDto {
  gitRepositoryUrl?: string | null;
  gitRepositorySetupMode?: 'clone' | 'empty';
  agentTypes: AgentTypeInfo[];
  /** Container isolation levels the agent manager host can run. */
  isolation?: HostIsolationCapabilitiesDto;
}

/** Lightweight reachability check of a workspace's agent-manager (`GET /clients/:id/ping`). */
export interface ClientPingResponseDto {
  reachable: boolean;
  /** Why the workspace cannot be reached (only when `reachable` is false). */
  error?: string;
  checkedAt: string;
}

export interface ClientResponseDto {
  id: string;
  name: string;
  description?: string;
  endpoint: string;
  authenticationType: ClientAuthenticationType;
  config?: ConfigResponseDto;
  isAutoProvisioned: boolean;
  /** True if the current user may change autonomy, env vars, agents, and workspace settings. */
  canManageWorkspaceConfiguration: boolean;
  /** Container isolation levels of the workspace host (recommendation, ready levels, revision). */
  isolation?: ClientIsolationSummaryDto;
  createdAt: string;
  updatedAt: string;
}

export interface CreateClientDto {
  name: string;
  description?: string;
  endpoint: string;
  authenticationType: ClientAuthenticationType;
  apiKey?: string;
  keycloakClientId?: string;
  keycloakClientSecret?: string;
  keycloakRealm?: string;
  keycloakAuthServerUrl?: string;
  gitRepositorySetupMode?: 'clone' | 'empty';
  gitRepositoryUrl?: string;
  gitUsername?: string;
  gitToken?: string;
  gitPassword?: string;
  gitPrivateKey?: string;
  agentDefaultImage?: string;
  /** Provision flow only; `true`|`false` for AUTO_ENRICH_ENABLED_GLOBAL on the new server. */
  autoEnrichEnabledGlobal?: string;
  /** 0–2; written as AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE on the new server (optional). */
  autoEnrichVectorMaxCosineDistance?: number;
}

export interface UpdateClientDto {
  name?: string;
  description?: string;
  endpoint?: string;
  authenticationType?: ClientAuthenticationType;
  apiKey?: string;
  keycloakClientId?: string;
  keycloakClientSecret?: string;
  keycloakRealm?: string;
}

export interface CreateClientResponseDto extends ClientResponseDto {
  apiKey?: string;
}

export interface ListClientsParams {
  limit?: number;
  offset?: number;
  search?: string;
}

// Provisioning types
export interface ProvisioningProviderInfo {
  type: string;
  displayName: string;
}

export interface ServerType {
  id: string;
  name: string;
  cores: number;
  memory: number;
  disk: number;
  priceMonthly?: number;
  priceHourly?: number;
  description?: string;
}

export interface ProviderLocation {
  id: string;
  name: string;
  city?: string;
  country?: string;
}

export interface ProvisionServerDto {
  providerType: string;
  serverType: string;
  name: string;
  description?: string;
  location?: string;
  authenticationType: ClientAuthenticationType;
  apiKey?: string;
  keycloakClientId?: string;
  keycloakClientSecret?: string;
  keycloakRealm?: string;
  keycloakAuthServerUrl?: string;
  gitRepositorySetupMode?: 'clone' | 'empty';
  gitRepositoryUrl?: string;
  gitUsername?: string;
  gitToken?: string;
  gitPassword?: string;
  gitPrivateKey?: string;
  agentDefaultImage?: string;
  /** When set, written to provisioned server as AUTO_ENRICH_ENABLED_GLOBAL (`true`|`false`). */
  autoEnrichEnabledGlobal?: string;
  /** When set, written as AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE (0–2). */
  autoEnrichVectorMaxCosineDistance?: number;
}

export interface ProvisionedServerResponseDto extends ClientResponseDto {
  providerType: string;
  serverId: string;
  serverName: string;
  publicIp: string;
  privateIp?: string;
  serverStatus: string;
}

export interface ServerInfo {
  serverId: string;
  serverName?: string;
  publicIp?: string;
  privateIp?: string;
  serverStatus?: string;
  providerType: string;
}

// Client user management (per-client permissions)
export type ClientUserRole = 'admin' | 'user';

export interface ClientUserResponseDto {
  id: string;
  userId: string;
  clientId: string;
  role: ClientUserRole;
  userEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AddClientUserDto {
  email: string;
  role: ClientUserRole;
}
