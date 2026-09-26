import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import type { WorkspaceIndexChangeOp } from '../constants/workspace-index.constants';
import { AgentsRepository } from '../repositories/agents.repository';
import { shouldIgnoreWorkspaceIndexPath, toWorkspaceRelativePath } from '../utils/workspace-index-ignore';

import { DockerService } from './docker.service';
import { WorkspaceChangeNotifierService } from './workspace-change-notifier.service';

interface WatcherHandle {
  stop: () => Promise<void>;
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
}

const DEBOUNCE_MS = 250;
const INOTIFY_EXCLUDE = String.raw`/\.git(/|$)|/node_modules(/|$)`;

/**
 * Supervises per-agent inotifywait via docker exec. Emits path change notifications only.
 */
@Injectable()
export class WorkspaceInotifySupervisor implements OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceInotifySupervisor.name);
  private readonly watchers = new Map<string, WatcherHandle>();

  constructor(
    private readonly dockerService: DockerService,
    private readonly agentsRepository: AgentsRepository,
    private readonly changeNotifier: WorkspaceChangeNotifierService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    const agentIds = [...this.watchers.keys()];

    await Promise.all(agentIds.map((agentId) => this.stopWatcher(agentId)));
  }

  async startWatcher(agentId: string, basePath = '/app'): Promise<void> {
    await this.stopWatcher(agentId);

    const agent = await this.agentsRepository.findById(agentId);
    const containerId = agent?.containerId;

    if (!containerId) {
      this.logger.warn(`Cannot start workspace watcher: agent ${agentId} has no container`);

      return;
    }

    const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const pendingOps = new Map<string, WorkspaceIndexChangeOp>();

    const flushPath = (relativePath: string): void => {
      const op = pendingOps.get(relativePath) ?? 'upsert';

      pendingOps.delete(relativePath);
      this.changeNotifier.notifyPathChanges(agentId, [{ path: relativePath, op }], 'inotify');
    };

    const schedule = (relativePath: string, op: WorkspaceIndexChangeOp): void => {
      if (shouldIgnoreWorkspaceIndexPath(relativePath)) {
        return;
      }

      pendingOps.set(relativePath, op);
      const existing = debounceTimers.get(relativePath);

      if (existing) {
        clearTimeout(existing);
      }

      debounceTimers.set(
        relativePath,
        setTimeout(() => {
          debounceTimers.delete(relativePath);
          flushPath(relativePath);
        }, DEBOUNCE_MS),
      );
    };

    try {
      const handle = await this.dockerService.startStreamingExec(
        containerId,
        [
          'inotifywait',
          '-m',
          '-r',
          '-e',
          'create,delete,modify,move,close_write',
          '--exclude',
          INOTIFY_EXCLUDE,
          '--format',
          '%w%f|%e',
          basePath,
        ],
        (line) => {
          const parsed = this.parseInotifyLine(line, basePath);

          if (!parsed) {
            return;
          }

          schedule(parsed.path, parsed.op);
        },
      );

      this.watchers.set(agentId, { stop: handle.stop, debounceTimers });
      this.logger.log(`Started workspace inotify watcher for agent ${agentId}`);
    } catch (error: unknown) {
      this.logger.warn(`Failed to start workspace watcher for agent ${agentId}: ${(error as Error).message}`);
    }
  }

  async stopWatcher(agentId: string): Promise<void> {
    const existing = this.watchers.get(agentId);

    if (!existing) {
      return;
    }

    this.watchers.delete(agentId);

    for (const timer of existing.debounceTimers.values()) {
      clearTimeout(timer);
    }

    existing.debounceTimers.clear();

    try {
      await existing.stop();
    } catch (error: unknown) {
      this.logger.warn(`Error stopping watcher for agent ${agentId}: ${(error as Error).message}`);
    }
  }

  /**
   * After workspace setup completes: start watcher and request a full index rebuild.
   */
  async onWorkspaceReady(agentId: string, basePath = '/app'): Promise<void> {
    await this.startWatcher(agentId, basePath);
    this.changeNotifier.notifyRebuildRequired(agentId, 'workspace-ready');
  }

  parseInotifyLine(line: string, basePath: string): { path: string; op: WorkspaceIndexChangeOp } | null {
    const separator = line.lastIndexOf('|');

    if (separator <= 0) {
      return null;
    }

    const absolutePath = line.slice(0, separator).trim();
    const events = line.slice(separator + 1).toUpperCase();
    const relative = toWorkspaceRelativePath(absolutePath, basePath);

    if (!relative) {
      return null;
    }

    const op: WorkspaceIndexChangeOp = events.includes('DELETE') || events.includes('MOVED_FROM') ? 'delete' : 'upsert';

    return { path: relative, op };
  }
}
