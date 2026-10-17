import { nodeImportSpecSchema, type Resource } from '@forepath/loadweaver/shared/util-model';
import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { NodeEntity } from '../entities/node.entity';
import { canonicalJson } from '../utils/canonical-json.utils';
import { ImportSelectionEntity, NodeDiscoveryEntity } from './import.entities';

/**
 * Applying a `NodeImport` (3.21), inside the plan's apply transaction and before the re-plan: the pending node becomes
 * `importing` (schedulable for its imported deployments, still without a desired state), keeps the host ports its
 * discovery found, and the selection starts running — the import controller takes the steps from there. Refused when
 * the node no longer waits for this plan or a newer discovery made the plan stale.
 */
export async function syncNodeImport(manager: EntityManager, resource: Resource<'NodeImport'>): Promise<void> {
  const spec = nodeImportSpecSchema.parse(resource.spec);
  const node = await manager
    .getRepository(NodeEntity)
    .findOne({ where: { name: spec.node }, lock: { mode: 'pessimistic_write' } });
  const selection = await manager
    .getRepository(ImportSelectionEntity)
    .findOne({ where: { id: spec.selection }, lock: { mode: 'pessimistic_write' } });

  if (!node || (node.lifecycle !== 'pending' && !(node.lifecycle === 'importing' && selection?.status === 'running')))
    throw new ConflictException(`node ${spec.node} is not waiting for a join plan`);

  if (!selection || selection.node !== spec.node || (selection.status !== 'planned' && selection.status !== 'running'))
    throw new ConflictException(`the import selection of ${spec.node} is not open any more`);

  // Only what the import wizard built is executed: a hand-written NodeImport can't add copies or stops of its own.
  if (
    canonicalJson(spec.steps) !== canonicalJson(selection.joinPlan.steps) ||
    spec.wipeFormerIdentity !== selection.joinPlan.wipeFormerIdentity
  )
    throw new ConflictException(`the NodeImport of ${spec.node} differs from the join plan the import wizard built`);

  const discovery = await manager.getRepository(NodeDiscoveryEntity).findOne({ where: { node: spec.node } });

  if (!discovery || discovery.id !== spec.discovery)
    throw new ConflictException(
      `node ${spec.node} was discovered again since this plan was made; build the join plan again`,
    );

  node.lifecycle = 'importing';
  node.reservedPorts = { tcp: spec.reservedPorts.tcp, udp: spec.reservedPorts.udp };
  await manager.getRepository(NodeEntity).save(node);

  if (selection.status === 'planned') {
    selection.status = 'running';
    selection.error = null;
    await manager.getRepository(ImportSelectionEntity).save(selection);
  }
}
