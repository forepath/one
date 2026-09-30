import type { AgentChatSessionSummaryDto } from '../chat-sessions/chat-sessions.types';

// Types based on OpenAPI spec
export interface AgentTypeCapabilities {
  transport?: 'acp' | 'opencode-http' | 'http';
  supportsChat: boolean;
  supportsStreaming: boolean;
  supportsToolEvents: boolean;
  supportsQuestions: boolean;
}

export interface AgentResponseDto {
  id: string;
  name: string;
  description?: string;
  agentType: string;
  containerType: ContainerType;
  capabilities?: AgentTypeCapabilities;
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
  /** User-visible chat sessions for this agent (primary + user; never hidden/background). */
  chats: AgentChatSessionSummaryDto[];
  /** Id of the primary chat session for this agent. */
  primaryChatId: string;
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
  search?: string;
}

/** Model id → display name, as returned by GET .../agents/:agentId/models (proxied agent-manager). */
export type AgentModelsMap = Record<string, string>;

/** Slash typeahead entry mirroring OpenCode `GET /command` (`/name` + optional description). */
export interface AgentSlashCommand {
  name: string;
  description?: string;
  /** OpenCode registry source when loaded from the worker. */
  source?: 'command' | 'mcp' | 'skill';
}

export enum ContainerType {
  GENERIC = 'generic',
  DOCKER = 'docker',
  TERRAFORM = 'terraform',
  KUBERNETES = 'kubernetes',
}
