export interface EnvironmentStatus {
  clientId: string;
  agentId: string;
  hasUnreadMessages: boolean;
  gitDirty: boolean;
  gitConflict: boolean;
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
}

export interface StatusPatchPayload {
  generatedAt: string;
  environments?: EnvironmentStatus[];
  clients?: ClientStatus[];
  spacesHasAttention?: boolean;
}

export interface ActiveEnvironment {
  clientId: string;
  agentId: string;
}
