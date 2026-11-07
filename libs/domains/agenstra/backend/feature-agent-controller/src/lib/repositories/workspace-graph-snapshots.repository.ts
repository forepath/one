import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { WorkspaceGraphSnapshotEntity } from '../entities/workspace-graph-snapshot.entity';

export type WorkspaceGraphSnapshotFields = Partial<
  Pick<WorkspaceGraphSnapshotEntity, 'status' | 'graph' | 'nodeCount' | 'edgeCount' | 'builtAt' | 'error'>
>;

/** Thin TypeORM wrapper for workspace graph snapshots (one row per workspace). */
@Injectable()
export class WorkspaceGraphSnapshotsRepository {
  constructor(
    @InjectRepository(WorkspaceGraphSnapshotEntity)
    private readonly repository: Repository<WorkspaceGraphSnapshotEntity>,
  ) {}

  async findByClientId(clientId: string): Promise<WorkspaceGraphSnapshotEntity | null> {
    return await this.repository.findOne({ where: { clientId } });
  }

  async findByClientIds(clientIds: string[]): Promise<WorkspaceGraphSnapshotEntity[]> {
    if (clientIds.length === 0) {
      return [];
    }

    return await this.repository.find({ where: { clientId: In(clientIds) } });
  }

  /** Status columns only (no graph payload). */
  async findStatusesByClientIds(clientIds: string[]): Promise<WorkspaceGraphSnapshotEntity[]> {
    if (clientIds.length === 0) {
      return [];
    }

    return await this.repository.find({
      where: { clientId: In(clientIds) },
      select: ['id', 'clientId', 'status', 'nodeCount', 'edgeCount', 'builtAt', 'error', 'updatedAt'],
    });
  }

  /** Insert or update the row of a workspace (only the given fields change). */
  async upsert(clientId: string, fields: WorkspaceGraphSnapshotFields): Promise<WorkspaceGraphSnapshotEntity> {
    const existing = await this.findByClientId(clientId);

    if (existing) {
      Object.assign(existing, fields);

      return await this.repository.save(existing);
    }

    return await this.repository.save(
      this.repository.create({
        clientId,
        status: 'missing',
        graph: null,
        nodeCount: 0,
        edgeCount: 0,
        builtAt: null,
        error: null,
        ...fields,
      }),
    );
  }
}
