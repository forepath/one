// Types based on OpenAPI spec
export type ClientAuthenticationType = 'api_key' | 'keycloak';

export interface AgentTypeInfo {
  type: string;
  displayName: string;
}

export interface ConfigResponseDto {
  gitRepositoryUrl?: string | null;
  gitRepositorySetupMode?: 'clone' | 'empty';
  agentTypes: AgentTypeInfo[];
}

export interface ClientResponseDto {
  id: string;
  name: string;
  description?: string;
  endpoint: string;
  authenticationType: ClientAuthenticationType;
  agentWsPort?: number;
  config?: ConfigResponseDto;
  isAutoProvisioned: boolean;
  /** True if the current user may change autonomy, env vars, agents, and workspace settings. */
  canManageWorkspaceConfiguration: boolean;
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
  agentWsPort?: number;
  gitRepositorySetupMode?: 'clone' | 'empty';
  gitRepositoryUrl?: string;
  gitUsername?: string;
  gitToken?: string;
  gitPassword?: string;
  gitPrivateKey?: string;
  cursorApiKey?: string;
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
  agentWsPort?: number;
}

export interface CreateClientResponseDto extends ClientResponseDto {
  apiKey?: string;
}

export interface ListClientsParams {
  limit?: number;
  offset?: number;
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
  agentWsPort?: number;
  gitRepositorySetupMode?: 'clone' | 'empty';
  gitRepositoryUrl?: string;
  gitUsername?: string;
  gitToken?: string;
  gitPassword?: string;
  gitPrivateKey?: string;
  cursorApiKey?: string;
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
