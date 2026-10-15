import type { AgentChatSessionSummaryDto } from '../chat-sessions/chat-sessions.types';
import type { IsolationLevel } from '../clients/clients.types';

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
  git?: {
    repositoryUrl?: string;
    setupMode: 'clone' | 'empty';
  };
  /** User-visible chat sessions for this agent (primary + user; never hidden/background). */
  chats: AgentChatSessionSummaryDto[];
  /** Id of the primary chat session for this agent. */
  primaryChatId: string;
  /** Container isolation level of this environment (runtime and selection record). */
  isolation?: AgentIsolationDto;
  createdAt: string;
  updatedAt: string;
}

/** How the isolation level of an environment was selected (audit record). */
export interface AgentIsolationSelectionDto {
  /** Level that was automatically recommended when the environment was created. */
  automaticSelection?: IsolationLevel | null;
  /** Level the environment actually runs with. */
  effectiveSelection: IsolationLevel;
  selectionSource: 'automatic' | 'user-confirmed' | 'user-override';
  selectedBy?: string | null;
  selectedAt: string;
  /** Host capability revision the selection was validated against. */
  capabilityRevision?: string | null;
}

/** Effective container isolation of an environment. */
export interface AgentIsolationDto {
  level: IsolationLevel;
  /** Docker runtime the environment's worker container runs on. */
  runtime: string;
  selection?: AgentIsolationSelectionDto | null;
}

export interface CreateAgentDto {
  name: string;
  description?: string;
  agentType?: string;
  containerType?: ContainerType;
  gitRepositorySetupMode?: 'clone' | 'empty';
  gitRepositoryUrl?: string;
  /** Container isolation level; omitted = the host's recommended level. */
  isolationLevel?: IsolationLevel;
  /** Isolation capability revision the selection was made against (`ClientIsolationSummaryDto.revision`). */
  capabilityRevision?: string;
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
