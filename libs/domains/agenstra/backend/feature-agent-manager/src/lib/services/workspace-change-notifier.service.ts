import { Injectable, Logger } from '@nestjs/common';

import {
  WORKSPACE_INDEX_CHANGED_EVENT,
  WORKSPACE_INDEX_REBUILD_REQUIRED_EVENT,
  WORKSPACE_SYSTEM_SOCKET_ID,
  type WorkspaceIndexChangedData,
  type WorkspaceIndexPathChange,
  type WorkspaceIndexRebuildRequiredData,
} from '../constants/workspace-index.constants';
import { shouldIgnoreWorkspaceIndexPath } from '../utils/workspace-index-ignore';

export interface FileUpdateNotificationBroadcast {
  socketId: string;
  filePath: string;
  timestamp: string;
  reason?: string;
}

type IndexChangedBroadcaster = (agentId: string, event: string, data: unknown) => void;
type FileUpdateBroadcaster = (agentId: string, data: FileUpdateNotificationBroadcast) => void;

/**
 * Fan-out for workspace index / file change notifications (no file bodies).
 * Gateway registers broadcasters on init.
 */
@Injectable()
export class WorkspaceChangeNotifierService {
  private readonly logger = new Logger(WorkspaceChangeNotifierService.name);
  private indexBroadcaster?: IndexChangedBroadcaster;
  private fileUpdateBroadcaster?: FileUpdateBroadcaster;

  registerIndexBroadcaster(broadcaster: IndexChangedBroadcaster): void {
    this.indexBroadcaster = broadcaster;
  }

  registerFileUpdateBroadcaster(broadcaster: FileUpdateBroadcaster): void {
    this.fileUpdateBroadcaster = broadcaster;
  }

  notifyPathChanges(agentId: string, changes: WorkspaceIndexPathChange[], reason: string): void {
    const filtered = changes.filter((change) => !shouldIgnoreWorkspaceIndexPath(change.path));

    if (filtered.length === 0) {
      return;
    }

    const timestamp = new Date().toISOString();
    const payload: WorkspaceIndexChangedData = {
      agentId,
      changes: filtered,
      reason,
      timestamp,
    };

    this.emitIndex(agentId, WORKSPACE_INDEX_CHANGED_EVENT, payload);

    for (const change of filtered) {
      if (change.op === 'upsert' || change.op === 'delete') {
        this.emitFileUpdate(agentId, {
          socketId: WORKSPACE_SYSTEM_SOCKET_ID,
          filePath: change.path,
          timestamp,
          reason,
        });
      }
    }
  }

  notifyRebuildRequired(agentId: string, reason: string, paths?: string[]): void {
    const timestamp = new Date().toISOString();
    const payload: WorkspaceIndexRebuildRequiredData = {
      agentId,
      reason,
      timestamp,
      paths: paths?.filter((path) => !shouldIgnoreWorkspaceIndexPath(path)),
    };

    this.emitIndex(agentId, WORKSPACE_INDEX_REBUILD_REQUIRED_EVENT, payload);
  }

  private emitIndex(agentId: string, event: string, data: unknown): void {
    if (!this.indexBroadcaster) {
      return;
    }

    try {
      this.indexBroadcaster(agentId, event, data);
    } catch (error: unknown) {
      this.logger.warn(`Failed to broadcast ${event} for agent ${agentId}: ${(error as Error).message}`);
    }
  }

  private emitFileUpdate(agentId: string, data: FileUpdateNotificationBroadcast): void {
    if (!this.fileUpdateBroadcaster) {
      return;
    }

    try {
      this.fileUpdateBroadcaster(agentId, data);
    } catch (error: unknown) {
      this.logger.warn(`Failed to broadcast fileUpdateNotification for agent ${agentId}: ${(error as Error).message}`);
    }
  }
}
