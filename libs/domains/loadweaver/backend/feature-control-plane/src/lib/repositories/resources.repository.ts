import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { ResourceEntity } from '../entities/resource.entity';

/**
 * Repository for declarative resources (desired state).
 */
@Injectable()
export class ResourcesRepository {
  constructor(
    @InjectRepository(ResourceEntity)
    private readonly repository: Repository<ResourceEntity>,
  ) {}

  async findByKind(kind: string): Promise<ResourceEntity[]> {
    return await this.repository.find({ where: { kind }, order: { projectKey: 'ASC', name: 'ASC' } });
  }

  async findOne(kind: string, name: string, project?: string | null): Promise<ResourceEntity | null> {
    return await this.repository.findOne({ where: { kind, name, projectKey: project ?? '' } });
  }

  async findAll(filter: { kind?: string; project?: string | null } = {}): Promise<ResourceEntity[]> {
    return await this.repository.find({
      where: {
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.project !== undefined ? { projectKey: filter.project ?? '' } : {}),
      },
      order: { kind: 'ASC', projectKey: 'ASC', name: 'ASC' },
    });
  }

  /** Locks the given resources for the rest of the transaction (per-resource scope, 3.8). */
  async findForUpdate(
    manager: EntityManager,
    keys: { kind: string; name: string; project?: string | null }[],
  ): Promise<ResourceEntity[]> {
    if (keys.length === 0) return [];

    const qb = manager.getRepository(ResourceEntity).createQueryBuilder('r').setLock('pessimistic_write');

    keys.forEach((key, i) => {
      qb.orWhere(`(r.kind = :k${i} AND r.name = :n${i} AND r.project_key = :p${i})`, {
        [`k${i}`]: key.kind,
        [`n${i}`]: key.name,
        [`p${i}`]: key.project ?? '',
      });
    });

    return await qb.getMany();
  }
}
