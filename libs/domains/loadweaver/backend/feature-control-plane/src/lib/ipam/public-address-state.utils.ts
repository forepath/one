import type { PublicAddress } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { IpPoolSpec, NodeGroupSpec } from '@forepath/loadweaver/shared/util-model';

import type { NodeEntity } from '../entities/node.entity';
import type { PublicAddressEntity } from '../entities/public-address.entity';
import { plannerNodes } from '../services/workload-planner.service';
import { holderCandidates, type HolderNode } from './public-ipam.utils';

/** Nodes as holder candidates: lifecycle, labels and reachability (heartbeat). */
export function holderNodes(nodes: NodeEntity[], now: number): HolderNode[] {
  return plannerNodes(nodes, now).map((n) => ({
    name: n.name,
    site: n.site,
    labels: n.labels,
    lifecycle: n.lifecycle,
    reachable: n.reachable,
  }));
}

export const UPLINK_LABEL = 'loadweaver.com/uplink';
const HOLDER_PRIORITY = 200;
const CANDIDATE_PRIORITY = 100;

/**
 * Public addresses of one node (3.6): every candidate of a VRRP or BGP address gets it (keepalived / BGP pick the
 * active one, the preferred holder with the highest priority); provider and static addresses only on the holder.
 */
export function nodePublicAddresses(
  node: HolderNode,
  rows: readonly Pick<PublicAddressEntity, 'address' | 'pool' | 'state' | 'holder' | 'vrid'>[],
  pools: ReadonlyMap<string, IpPoolSpec>,
  groups: ReadonlyMap<string, NodeGroupSpec>,
  nodes: readonly HolderNode[],
): PublicAddress[] {
  const uplink = node.labels[UPLINK_LABEL];
  const result: PublicAddress[] = [];

  for (const row of rows.filter((r) => r.state === 'assigned')) {
    const pool = pools.get(row.pool);

    if (!pool) continue;

    const candidates = holderCandidates(groups.get(pool.nodeGroup), nodes);
    const base = {
      address: row.address,
      ...(uplink && /^[a-zA-Z0-9_.-]{1,15}$/.test(uplink) ? { interface: uplink } : {}),
    };

    if (pool.failover === 'vrrp' || pool.failover === 'bgp') {
      if (!candidates.includes(node.name)) continue;

      const active = row.holder === node.name;

      result.push(
        pool.failover === 'vrrp'
          ? {
              ...base,
              mode: 'vrrp',
              active,
              vrrp: {
                vrid: row.vrid ?? 1,
                priority: active ? HOLDER_PRIORITY : Math.max(1, CANDIDATE_PRIORITY - candidates.indexOf(node.name)),
              },
            }
          : { ...base, mode: 'bgp', active },
      );
    } else if (row.holder === node.name) {
      result.push({ ...base, mode: pool.failover, active: true });
    }
  }

  return result.sort((a, b) => a.address.localeCompare(b.address));
}
