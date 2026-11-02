import { isIP } from 'node:net';

import {
  matchesSelector,
  type DnsProviderSpec,
  type DnsZoneSpec,
  type NodeGroupSpec,
} from '@forepath/loadweaver/shared/util-model';

import type { NameServer } from './zone-file';

export interface HostedNode {
  name: string;
  site: string;
  labels: Record<string, string> | null;
  lifecycle: string;
  controlPlane: boolean;
  endpointHost: string | null;
}

/** Nodes running a bind9 provider: its node group, or the control-plane members (3.15). */
export function bind9Nodes(
  provider: DnsProviderSpec,
  groups: ReadonlyMap<string, NodeGroupSpec>,
  nodes: readonly HostedNode[],
): HostedNode[] {
  const group = provider.nodeGroup ? groups.get(provider.nodeGroup) : undefined;

  return nodes
    .filter((n) => n.lifecycle === 'active' || n.lifecycle === 'cordoned')
    .filter((n) =>
      group
        ? matchesSelector(group.selector, {
            name: n.name,
            labels: { ...(n.labels ?? {}), 'loadweaver.com/site': n.site, 'loadweaver.com/node': n.name },
          })
        : n.controlPlane,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Public addresses a name server answers on: its endpoint, when that is an IP literal. */
export function nameServerAddresses(node: HostedNode): string[] {
  return node.endpointHost && isIP(node.endpointHost) ? [node.endpointHost] : [];
}

/** `ns1..nsN.<zone>` for the bind9 nodes, with their addresses as glue. */
export function zoneNameServers(zone: DnsZoneSpec, nodes: readonly HostedNode[]): NameServer[] {
  return nodes
    .filter((n) => nameServerAddresses(n).length > 0)
    .map((n, i) => ({ name: `ns${i + 1}.${zone.zone}`, addresses: nameServerAddresses(n) }));
}

/** Delegation needs two name servers on different IPs, ideally in different sites (3.15, pin otherwise). */
export function nameServerWarnings(zone: DnsZoneSpec, nodes: readonly HostedNode[]): string[] {
  const usable = nodes.filter((n) => nameServerAddresses(n).length > 0);

  if (usable.length < 2)
    return [`zone ${zone.zone}: fewer than two name servers with public addresses (single point of failure)`];

  if (new Set(usable.map((n) => n.site)).size < 2)
    return [`zone ${zone.zone}: all name servers are in site ${usable[0].site}`];

  return [];
}
