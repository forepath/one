export interface EnvironmentStatusPayload {
  clientId: string;
  agentId: string;
  hasUnreadMessages: boolean;
  gitDirty: boolean;
  gitConflict: boolean;
}

export interface ClientStatusPayload {
  clientId: string;
  hasUnreadMessages: boolean;
  gitDirty: boolean;
}

export interface StatusSnapshotPayload {
  generatedAt: string;
  environments: EnvironmentStatusPayload[];
  clients: ClientStatusPayload[];
  spacesHasAttention: boolean;
}

export interface StatusPatchPayload {
  generatedAt: string;
  environments?: EnvironmentStatusPayload[];
  clients?: ClientStatusPayload[];
  spacesHasAttention?: boolean;
}

export interface MarkEnvironmentReadPayload {
  clientId: string;
  agentId: string;
}

export interface SetActiveEnvironmentPayload {
  clientId: string | null;
  agentId: string | null;
}
