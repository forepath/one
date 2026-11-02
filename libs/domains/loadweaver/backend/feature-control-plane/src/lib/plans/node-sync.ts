import type { Resource } from '@forepath/loadweaver/shared/util-model';
import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { NodeEntity } from '../entities/node.entity';

/** The declarative part of a node (site, labels, cordon) lives in its `Node` resource. */
export async function syncNode(manager: EntityManager, resource: Resource<'Node'>): Promise<void> {
  const repo = manager.getRepository(NodeEntity);
  const node = await repo.findOne({ where: { name: resource.metadata.name }, lock: { mode: 'pessimistic_write' } });

  if (!node) throw new ConflictException(`node ${resource.metadata.name} is no longer part of the cluster`);

  node.site = resource.spec.site;
  node.labels = resource.spec.labels ?? {};

  if (resource.spec.unschedulable && node.lifecycle === 'active') node.lifecycle = 'cordoned';

  if (!resource.spec.unschedulable && node.lifecycle === 'cordoned') node.lifecycle = 'active';

  await repo.save(node);
}
