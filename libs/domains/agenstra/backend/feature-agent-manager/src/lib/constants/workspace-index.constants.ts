/** WebSocket events for workspace index change stream (notifications only — no file bodies). */
export const WORKSPACE_INDEX_CHANGED_EVENT = 'workspaceIndexChanged';
export const WORKSPACE_INDEX_REBUILD_REQUIRED_EVENT = 'workspaceIndexRebuildRequired';

/** Socket id used for system-originated fileUpdateNotification (not a peer editor save). */
export const WORKSPACE_SYSTEM_SOCKET_ID = 'system';

export type WorkspaceIndexChangeOp = 'upsert' | 'delete';

export interface WorkspaceIndexPathChange {
  path: string;
  op: WorkspaceIndexChangeOp;
}

export interface WorkspaceIndexChangedData {
  agentId: string;
  changes: WorkspaceIndexPathChange[];
  reason: string;
  timestamp: string;
}

export interface WorkspaceIndexRebuildRequiredData {
  agentId: string;
  reason: string;
  timestamp: string;
  /** Optional path inventory chunks (no content) to speed controller crawl. */
  paths?: string[];
}
