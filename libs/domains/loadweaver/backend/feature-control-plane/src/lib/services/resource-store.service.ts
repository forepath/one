import {
  LOADWEAVER_API_VERSION,
  parseResource,
  type Resource,
  type ResourceKind,
  type ResourceSpec,
} from '@forepath/loadweaver/shared/util-model';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { ResourceEntity } from '../entities/resource.entity';
import { ResourcesRepository } from '../repositories/resources.repository';

/** Converts a stored row back into a validated, defaulted resource. */
export function entityToResource(entity: ResourceEntity): Resource {
  const result = parseResource({
    apiVersion: LOADWEAVER_API_VERSION,
    kind: entity.kind,
    metadata: {
      name: entity.name,
      ...(entity.project ? { project: entity.project } : {}),
      ...(Object.keys(entity.labels ?? {}).length ? { labels: entity.labels } : {}),
      ...(Object.keys(entity.annotations ?? {}).length ? { annotations: entity.annotations } : {}),
    },
    spec: entity.spec,
  });

  if (!result.ok) {
    // Stored state is validated on write; reaching this means a schema change without migration.
    throw new InternalServerErrorException(`stored resource ${entity.kind}/${entity.name} no longer validates`);
  }

  return result.resource;
}

/** Normalizes a resource (defaults applied) before it is stored or compared. */
export function normalizeResource(resource: Resource): Resource {
  const result = parseResource(resource);

  if (result.ok === false)
    throw new Error(`invalid resource: ${result.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);

  return result.resource;
}

/**
 * Read / write access to desired state as typed resources.
 */
@Injectable()
export class ResourceStoreService {
  constructor(private readonly resources: ResourcesRepository) {}

  async list<K extends ResourceKind>(kind: K): Promise<Resource<K>[]> {
    return (await this.resources.findByKind(kind)).map((e) => entityToResource(e) as Resource<K>);
  }

  async listAll(filter: { kind?: string; project?: string | null } = {}): Promise<Resource[]> {
    return (await this.resources.findAll(filter)).map(entityToResource);
  }

  async get<K extends ResourceKind>(kind: K, name: string, project?: string | null): Promise<Resource<K> | null> {
    const entity = await this.resources.findOne(kind, name, project);

    return entity ? (entityToResource(entity) as Resource<K>) : null;
  }

  /** The single `Cluster` resource. */
  async clusterSpec(): Promise<ResourceSpec<'Cluster'>> {
    const [cluster] = await this.list('Cluster');

    if (!cluster) throw new InternalServerErrorException('cluster resource missing');

    return cluster.spec;
  }

  /** Inserts or updates one resource inside a transaction; returns the new generation. */
  async upsert(manager: EntityManager, resource: Resource, updatedBy: string | null): Promise<number> {
    const normalized = normalizeResource(resource);
    const repo = manager.getRepository(ResourceEntity);
    const projectKey = normalized.metadata.project ?? '';
    const existing = await repo.findOne({
      where: { kind: normalized.kind, name: normalized.metadata.name, projectKey },
    });
    const values = {
      labels: normalized.metadata.labels ?? {},
      annotations: normalized.metadata.annotations ?? {},
      spec: normalized.spec as Record<string, unknown>,
      updatedBy,
    };

    if (existing) {
      existing.labels = values.labels;
      existing.annotations = values.annotations;
      existing.spec = values.spec;
      existing.updatedBy = values.updatedBy;
      existing.generation += 1;
      await repo.save(existing);

      return existing.generation;
    }

    await repo.save(
      repo.create({
        kind: normalized.kind,
        name: normalized.metadata.name,
        project: normalized.metadata.project ?? null,
        projectKey,
        generation: 1,
        ...values,
      }),
    );

    return 1;
  }

  async remove(manager: EntityManager, ref: { kind: string; name: string; project?: string | null }): Promise<boolean> {
    const result = await manager
      .getRepository(ResourceEntity)
      .delete({ kind: ref.kind, name: ref.name, projectKey: ref.project ?? '' });

    return (result.affected ?? 0) > 0;
  }
}
