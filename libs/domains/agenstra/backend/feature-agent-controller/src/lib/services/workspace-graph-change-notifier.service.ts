import { Injectable, Logger } from '@nestjs/common';

export type WorkspaceGraphChangeListener = (clientId: string, reason: string) => void;

/**
 * Fan-out for changes that alter a workspace's graph snapshot (knowledge pages and relations, tickets, chat plans,
 * environments). Writers only name the workspace; the snapshot service decides when to rebuild. No dependencies, so
 * any service can signal without creating injection cycles.
 */
@Injectable()
export class WorkspaceGraphChangeNotifierService {
  private readonly logger = new Logger(WorkspaceGraphChangeNotifierService.name);
  private readonly listeners = new Set<WorkspaceGraphChangeListener>();

  register(listener: WorkspaceGraphChangeListener): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  notify(clientId: string | null | undefined, reason: string): void {
    if (!clientId) {
      return;
    }

    for (const listener of this.listeners) {
      try {
        listener(clientId, reason);
      } catch (error) {
        this.logger.debug(`Graph change listener failed for workspace ${clientId}: ${String(error)}`);
      }
    }
  }
}
