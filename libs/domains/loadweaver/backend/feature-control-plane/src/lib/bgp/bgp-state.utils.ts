import type { ExternalBgp } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  autonomousSystemSpecSchema,
  bgpAnnouncementSpecSchema,
  bgpPeerSpecSchema,
  matchesSelector,
  peerMaxPrefixes,
  type AutonomousSystemSpec,
  type BgpAnnouncementSpec,
  type BgpPeerSpec,
  type IpPoolSpec,
  type NodeGroupSpec,
} from '@forepath/loadweaver/shared/util-model';
import { cidrContains, mustParseCidr } from '@forepath/loadweaver/shared/util-network';

import type { ResourceEntity } from '../entities/resource.entity';

/** Prepends for nodes that only back an address or prefix up (primary / backup, 3.27). */
export const BACKUP_PREPEND = 3;

export interface BgpResources {
  as: AutonomousSystemSpec | undefined;
  asCount: number;
  peers: Map<string, BgpPeerSpec>;
  announcements: Map<string, BgpAnnouncementSpec>;
}

export function bgpResources(resources: readonly Pick<ResourceEntity, 'kind' | 'name' | 'spec'>[]): BgpResources {
  const systems = resources.filter((r) => r.kind === 'AutonomousSystem');

  return {
    as: systems[0] ? autonomousSystemSpecSchema.parse(systems[0].spec) : undefined,
    asCount: systems.length,
    peers: new Map(resources.filter((r) => r.kind === 'BgpPeer').map((r) => [r.name, bgpPeerSpecSchema.parse(r.spec)])),
    announcements: new Map(
      resources
        .filter((r) => r.kind === 'BgpAnnouncement')
        .map((r) => [r.name, bgpAnnouncementSpecSchema.parse(r.spec)]),
    ),
  };
}

export interface BgpNode {
  name: string;
  site: string;
  labels: Record<string, string> | null;
  lifecycle: string;
}

function inGroup(groups: ReadonlyMap<string, NodeGroupSpec>, group: string, node: BgpNode): boolean {
  const spec = groups.get(group);

  return (
    !!spec &&
    matchesSelector(spec.selector, {
      name: node.name,
      labels: { ...(node.labels ?? {}), 'loadweaver.com/site': node.site, 'loadweaver.com/node': node.name },
    })
  );
}

function owned(prefix: string, owners: readonly string[]): boolean {
  const inner = mustParseCidr(prefix);

  return owners.some((o) => {
    const outer = mustParseCidr(o);

    return outer.family === inner.family && cidrContains(outer, inner);
  });
}

/** Rejects what must never happen (3.27): more than one AS, announcing prefixes the cluster doesn't hold. */
export function validateBgp(bgp: BgpResources, pools: ReadonlyMap<string, IpPoolSpec>): string[] {
  const errors: string[] = [];
  const holdings = [...(bgp.as?.prefixes ?? []), ...[...pools.values()].flatMap((p) => p.cidrs)];

  if (bgp.asCount > 1) errors.push('only one AutonomousSystem per cluster');

  if (!bgp.as && (bgp.peers.size > 0 || bgp.announcements.size > 0))
    errors.push('BGP peers and announcements need an AutonomousSystem');

  for (const [name, a] of bgp.announcements) {
    for (const prefix of a.prefixes.filter((p) => !owned(p, holdings)))
      errors.push(
        `BgpAnnouncement ${name}: ${prefix} is not held by the cluster (AutonomousSystem prefixes or IP pools)`,
      );

    for (const peer of (a.peers ?? []).filter((p) => !bgp.peers.has(p)))
      errors.push(`BgpAnnouncement ${name}: peer ${peer} does not exist`);
  }

  return errors;
}

/** Plan warnings (3.12, 3.27): single announcing node, anycast for L4, BGP failover without peers. */
export function bgpWarnings(
  bgp: BgpResources,
  pools: ReadonlyMap<string, IpPoolSpec>,
  groups: ReadonlyMap<string, NodeGroupSpec>,
  nodes: readonly BgpNode[],
  hasL4Forwards: boolean,
): string[] {
  const warnings: string[] = [];
  const peering = (n: BgpNode) => [...bgp.peers.values()].some((p) => inGroup(groups, p.nodeGroup, n));
  const active = nodes.filter((n) => n.lifecycle === 'active' || n.lifecycle === 'cordoned');

  for (const [name, a] of bgp.announcements) {
    const from = active.filter((n) => inGroup(groups, a.nodeGroup, n) && peering(n));

    if (from.length < 2)
      warnings.push(
        `BgpAnnouncement ${name}: announced from ${from.length === 0 ? 'no node with a peer' : `a single node (${from[0].name})`}; a failure takes the prefixes offline`,
      );

    if (a.mode === 'anycast' && hasL4Forwards)
      warnings.push(
        `BgpAnnouncement ${name}: anycast with L4 port forwards; long-lived connections can break when routing shifts between sites`,
      );
  }

  for (const [name, pool] of pools) {
    if (pool.failover === 'bgp' && !active.some((n) => inGroup(groups, pool.nodeGroup, n) && peering(n)))
      warnings.push(`IpPool ${name}: BGP failover, but no node of ${pool.nodeGroup} has a BGP peer`);
  }

  return warnings;
}

/** A replica that is up (healthy, or running without a health check), for health-gated announcements. */
export interface HealthyReplica {
  /** `project/deployment/service`. */
  service: string;
  node: string;
  site: string;
}

/** Whether an announcement's backing service is healthy where it has to be for this node (3.27). */
function backed(a: BgpAnnouncementSpec, node: BgpNode, healthy: readonly HealthyReplica[]): boolean {
  if (!a.whenHealthy) return true;

  const { service, scope } = a.whenHealthy;

  return healthy.some(
    (r) =>
      r.service === service &&
      (scope === 'cluster' || (scope === 'site' ? r.site === node.site : r.node === node.name)),
  );
}

/** Up replicas from the placements' reported state on the node running them. */
export function healthyReplicas(
  placements: readonly {
    project: string;
    deployment: string;
    service: string;
    node: string;
    status: Record<string, { state: string }> | null;
  }[],
  sites: ReadonlyMap<string, string>,
  reachable: ReadonlySet<string>,
): HealthyReplica[] {
  // A node that stopped reporting keeps its last report: only reachable nodes' replicas count.
  return placements
    .filter((p) => reachable.has(p.node) && ['healthy', 'running'].includes(p.status?.[p.node]?.state ?? ''))
    .map((p) => ({
      service: `${p.project}/${p.deployment}/${p.service}`,
      node: p.node,
      site: sites.get(p.node) ?? '',
    }));
}

/**
 * External BGP of one node (3.27): its peers (by node group), the announcements its node groups make, BGP failover
 * addresses it may hold (the holder announces plainly, other candidates prepended as backup), graceful shutdown
 * while draining.
 */
export function nodeExternalBgp(
  node: BgpNode,
  bgp: BgpResources,
  groups: ReadonlyMap<string, NodeGroupSpec>,
  bgpAddresses: readonly { address: string; holder: string | null; candidates: readonly string[]; anycast?: boolean }[],
  healthyReplicas: readonly HealthyReplica[] = [],
): ExternalBgp | undefined {
  if (!bgp.as) return undefined;

  const peers = [...bgp.peers]
    .filter(([, p]) => inGroup(groups, p.nodeGroup, node))
    .sort(([a], [b]) => a.localeCompare(b));

  if (peers.length === 0) return undefined;

  const names = peers.map(([name]) => name);
  const announcements: ExternalBgp['announcements'] = [];

  for (const a of [...bgp.announcements.values()].filter(
    (x) => inGroup(groups, x.nodeGroup, node) && backed(x, node, healthyReplicas),
  )) {
    const to = (a.peers ?? names).filter((p) => names.includes(p));
    const prepend = a.prepend + (a.mode === 'primary-backup' && node.site !== a.primarySite ? BACKUP_PREPEND : 0);

    for (const prefix of a.prefixes)
      announcements.push({
        prefix,
        peers: to,
        communities: a.communities,
        prepend: Math.min(10, prepend),
        ...(a.med !== undefined ? { med: a.med } : {}),
      });
  }

  for (const address of bgpAddresses.filter((x) => x.candidates.includes(node.name))) {
    announcements.push({
      prefix: `${address.address}/${address.address.includes(':') ? 128 : 32}`,
      peers: names,
      communities: [],
      // Anycast addresses (e.g. name servers) are announced equally by every holder.
      prepend: address.anycast || address.holder === node.name ? 0 : BACKUP_PREPEND,
    });
  }

  return {
    asn: bgp.as.asn,
    peers: peers.map(([name, p]) => ({
      name,
      address: p.address,
      asn: p.asn,
      ...(p.multihop ? { multihop: p.multihop } : {}),
      bfd: p.bfd,
      import: p.import,
      maxPrefixes: peerMaxPrefixes(p),
      ...(p.localPref !== undefined ? { localPref: p.localPref } : {}),
    })),
    announcements: announcements.sort((a, b) => a.prefix.localeCompare(b.prefix)),
    rtrServers: bgp.as.rtrServers.map((s) => ({ address: s.address, port: s.port })),
    gracefulShutdown: node.lifecycle === 'draining',
  };
}
