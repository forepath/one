import type { EnvironmentProgressDto } from '@forepath/agenstra/backend/feature-agent-manager';

export interface ChatSessionStatusPayload {
  chatSessionId: string;
  hasUnreadMessages: boolean;
}

export interface EnvironmentStatusPayload {
  clientId: string;
  agentId: string;
  hasUnreadMessages: boolean;
  gitDirty: boolean;
  gitConflict: boolean;
  /** Visible chat sessions (primary + user); omitted/empty on older clients is treated as []. */
  chats?: ChatSessionStatusPayload[];
}

export interface ClientStatusPayload {
  clientId: string;
  hasUnreadMessages: boolean;
  gitDirty: boolean;
}

/** Active environment provisioning operations (create / update) of one workspace (client). */
export interface ClientEnvironmentProgressPayload {
  clientId: string;
  /** Running operations, oldest first; empty in a patch means all operations of the client finished. */
  operations: EnvironmentProgressDto[];
}

export interface StatusSnapshotPayload {
  generatedAt: string;
  environments: EnvironmentStatusPayload[];
  clients: ClientStatusPayload[];
  spacesHasAttention: boolean;
  /** Workspaces with running environment provisioning operations (omitted when none). */
  environmentProgress?: ClientEnvironmentProgressPayload[];
}

export interface StatusPatchPayload {
  generatedAt: string;
  environments?: EnvironmentStatusPayload[];
  clients?: ClientStatusPayload[];
  spacesHasAttention?: boolean;
  /** Workspaces whose provisioning operations changed (operations: [] when cleared). */
  environmentProgress?: ClientEnvironmentProgressPayload[];
}

export interface MarkEnvironmentReadPayload {
  clientId: string;
  agentId: string;
  /** When set, marks this visible chat session; otherwise marks primary (or env-only legacy). */
  chatSessionId?: string;
}

export interface MarkChatSessionReadPayload {
  clientId: string;
  agentId: string;
  chatSessionId: string;
}

export interface SetActiveEnvironmentPayload {
  clientId: string | null;
  agentId: string | null;
  chatSessionId?: string | null;
}
