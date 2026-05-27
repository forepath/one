// Types based on OpenAPI spec
export interface AgentResponseDto {
  id: string;
  name: string;
  description?: string;
  agentType: string;
  containerType: ContainerType;
  vnc?: {
    port: number;
    password: string;
  };
  ssh?: {
    port: number;
    password: string;
  };
  git?: {
    repositoryUrl?: string;
    setupMode: 'clone' | 'empty';
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentDto {
  name: string;
  description?: string;
  agentType?: string;
  containerType?: ContainerType;
  gitRepositorySetupMode?: 'clone' | 'empty';
  gitRepositoryUrl?: string;
  createVirtualWorkspace?: boolean;
  createSshConnection?: boolean;
}

export interface UpdateAgentDto {
  name?: string;
  description?: string;
  containerType?: ContainerType;
}

export interface CreateAgentResponseDto extends AgentResponseDto {
  password: string;
}

export interface ListClientAgentsParams {
  limit?: number;
  offset?: number;
}

/** Model id → display name, as returned by GET .../agents/:agentId/models (proxied agent-manager). */
export type AgentModelsMap = Record<string, string>;

export enum ContainerType {
  GENERIC = 'generic',
  DOCKER = 'docker',
  TERRAFORM = 'terraform',
  KUBERNETES = 'kubernetes',
}
