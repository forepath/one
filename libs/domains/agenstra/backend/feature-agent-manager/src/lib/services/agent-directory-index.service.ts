import { createHash } from 'node:crypto';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import type { FileNodeDto } from '../dto/file-node.dto';
import { AgentDirectoryIndexEntity } from '../entities/agent-directory-index.entity';
import { WorkspaceChangeNotifierService } from './workspace-change-notifier.service';

@Injectable()
export class AgentDirectoryIndexService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentDirectoryIndexService.name);
  private readonly queues = new Map<string, Promise<void>>();
  private readonly maxAgeMs = 30_000;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;

  constructor(
    @InjectRepository(AgentDirectoryIndexEntity)
    private readonly repository: Repository<AgentDirectoryIndexEntity>,
    private readonly changeNotifier: WorkspaceChangeNotifierService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.changeNotifier.registerTreeInvalidator((agentId) => this.invalidate(agentId));
    this.cleanupTimer = setInterval(() => {
      void this.repository
        .delete({ refreshedAt: LessThan(new Date(Date.now() - this.maxAgeMs)) })
        .catch((error: unknown) => this.logger.error(`Directory index cleanup failed: ${String(error)}`));
    }, this.maxAgeMs);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    clearInterval(this.cleanupTimer);
  }

  async getOrLoad(
    agentId: string,
    containerId: string,
    directoryPath: string,
    load: () => Promise<FileNodeDto[]>,
    refresh = false,
  ): Promise<FileNodeDto[]> {
    const id = createHash('sha256')
      .update(JSON.stringify([agentId, containerId, directoryPath]))
      .digest('hex');

    return this.enqueue(agentId, async () => {
      const entry = refresh ? null : await this.repository.findOneBy({ id });

      if (entry && Date.now() - entry.refreshedAt.getTime() < this.maxAgeMs) {
        return entry.nodes.map((node) => ({
          ...node,
          modifiedAt: node.modifiedAt ? new Date(node.modifiedAt) : undefined,
        }));
      }

      const startedAt = new Date();
      const nodes = await load();

      await this.repository.upsert({ id, agentId, containerId, directoryPath, nodes, refreshedAt: startedAt }, ['id']);

      return nodes;
    });
  }

  async invalidate(agentId: string): Promise<void> {
    await this.enqueue(agentId, async () => {
      await this.repository.delete({ agentId });
    });
  }

  // Serialize loads and invalidations so an in-flight listing cannot repopulate a deleted snapshot.
  private enqueue<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(agentId) ?? Promise.resolve()).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );

    this.queues.set(agentId, tail);
    void tail.then(() => {
      if (this.queues.get(agentId) === tail) {
        this.queues.delete(agentId);
      }
    });

    return result;
  }
}
