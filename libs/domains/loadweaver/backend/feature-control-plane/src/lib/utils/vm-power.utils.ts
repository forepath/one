import type { EntityManager } from 'typeorm';

import { VmPowerEntity } from '../entities/virtual-machine.entities';
import type { VmPower } from './vm-planning.utils';

/**
 * Operational state of VMs (3.35, W8's lifecycle API) as the planner takes it: `power` = the operational power of
 * `Manual` VMs (`<project>/<name>` → `stopped`; VMs without a row run), `generations` = cloud-init instance
 * generations bumped by `reimage` (absent = 1). Managers without repositories (unit-test doubles) yield empty maps.
 */
export async function loadVmOperationalState(
  manager: Pick<EntityManager, 'getRepository'> | undefined,
): Promise<{ power: Map<string, VmPower>; generations: Map<string, number> }> {
  if (typeof manager?.getRepository !== 'function') return { power: new Map(), generations: new Map() };

  const rows = (await manager.getRepository(VmPowerEntity)?.find?.()) ?? [];

  return {
    power: new Map(rows.filter((r) => r.desired === 'stopped').map((r) => [`${r.project}/${r.name}`, 'stopped'])),
    generations: new Map(
      rows.filter((r) => (r.instanceGeneration ?? 1) > 1).map((r) => [`${r.project}/${r.name}`, r.instanceGeneration]),
    ),
  };
}
