import type { ClientEnvironmentProgress } from '../environment-progress/environment-progress.types';

export interface ChatSessionStatus {
  chatSessionId: string;
  hasUnreadMessages: boolean;
}

export interface EnvironmentStatus {
  clientId: string;
  agentId: string;
  hasUnreadMessages: boolean;
  gitDirty: boolean;
  gitConflict: boolean;
  chats: ChatSessionStatus[];
}

export interface ClientStatus {
  clientId: string;
  hasUnreadMessages: boolean;
  gitDirty: boolean;
}

export interface StatusSnapshotPayload {
  generatedAt: string;
  environments: EnvironmentStatus[];
  clients: ClientStatus[];
  spacesHasAttention: boolean;
  /** Workspaces with running environment provisioning operations (omitted when none). */
  environmentProgress?: ClientEnvironmentProgress[];
}

export interface StatusPatchPayload {
  generatedAt: string;
  environments?: EnvironmentStatus[];
  clients?: ClientStatus[];
  spacesHasAttention?: boolean;
  /** Workspaces whose provisioning operations changed (`operations: []` once finished). */
  environmentProgress?: ClientEnvironmentProgress[];
}

export interface ActiveEnvironment {
  clientId: string;
  agentId: string;
  chatSessionId?: string | null;
}
