import { matchesSelector, type PolicyPeer } from '@forepath/loadweaver/shared/util-model';

import type {
  CompilerClient,
  CompilerDiagnostic,
  CompilerInput,
  CompilerNode,
  CompilerWorkload,
  EndpointKind,
  NamedPolicy,
} from './types';

/** Concrete addresses of one side of a policy, grouped by the node they live on. */
export interface Endpoint {
  kind: EndpointKind;
  /** Undefined for external endpoints (internet, CIDRs outside the cluster). */
  node?: string;
  addresses: string[];
}

export const INTERNET_ADDRESSES = ['0.0.0.0/0', '::/0'];

export function nodeAddresses(node: CompilerNode): string[] {
  return [node.overlayV4, node.overlayV6].filter((a): a is string => !!a);
}

function nodeEndpoints(nodes: readonly CompilerNode[]): Endpoint[] {
  return nodes
    .map((node) => ({ kind: 'node' as const, node: node.name, addresses: nodeAddresses(node) }))
    .filter((e) => e.addresses.length > 0);
}

/** Workloads grouped per node, so flows and tunnels can be derived per node pair. */
function workloadEndpoints(workloads: readonly CompilerWorkload[]): Endpoint[] {
  const byNode = new Map<string, string[]>();

  for (const workload of workloads) {
    const list = byNode.get(workload.node) ?? [];

    list.push(...workload.addresses);
    byNode.set(workload.node, list);
  }

  return [...byNode.entries()]
    .filter(([, addresses]) => addresses.length > 0)
    .map(([node, addresses]) => ({ kind: 'workload' as const, node, addresses }));
}

export function workloadGroupMembers(
  input: CompilerInput,
  project: string,
  groupName: string,
): CompilerWorkload[] | undefined {
  const group = input.workloadGroups.find((g) => g.project === project && g.name === groupName);

  if (!group) return undefined;

  return input.workloads.filter(
    (w) =>
      w.project === project &&
      ((w.groups ?? []).includes(groupName) ||
        matchesSelector(group.spec.selector, { name: w.service, labels: w.labels })),
  );
}

/** Valid clients whose effective groups include the client group; undefined for unknown groups. */
export function clientGroupMembers(input: CompilerInput, groupName: string): CompilerClient[] | undefined {
  if (!input.remoteAccess?.groups.includes(groupName)) return undefined;

  return input.remoteAccess.clients.filter((c) => c.groups.includes(groupName));
}

/** A client's addresses: its own and the networks behind it. */
export function clientAddresses(client: CompilerClient): string[] {
  return [client.address, ...client.subnets];
}

export function nodeGroupMembers(input: CompilerInput, groupName: string): CompilerNode[] | undefined {
  const group = input.nodeGroups.find((g) => g.name === groupName);

  if (!group) return undefined;

  return input.nodes.filter((n) => matchesSelector(group.spec.selector, { name: n.name, labels: n.labels }));
}

/**
 * Resolves one policy peer to endpoints. Group lookup order: an explicit `project` means a workload group
 * of that project; otherwise a workload group of the policy's own project, then a node group.
 * Hostname peers are L7 only and resolve to nothing here (handled by the proxy compiler).
 */
export function resolvePeer(
  input: CompilerInput,
  policy: NamedPolicy,
  peer: PolicyPeer,
  diagnostics: CompilerDiagnostic[],
): Endpoint[] {
  const policyId = policyKey(policy);

  if ('group' in peer) {
    const project = peer.project ?? policy.project;

    if (project) {
      const members = workloadGroupMembers(input, project, peer.group);

      if (members) return workloadEndpoints(members);

      if (peer.project) {
        diagnostics.push({
          level: 'error',
          policy: policyId,
          message: `unknown workload group ${peer.project}/${peer.group}`,
        });

        return [];
      }
    }

    const nodes = nodeGroupMembers(input, peer.group);

    if (nodes) return nodeEndpoints(nodes);

    diagnostics.push({ level: 'error', policy: policyId, message: `unknown group ${peer.group}` });

    return [];
  }

  if ('builtin' in peer) {
    switch (peer.builtin) {
      case 'internet':
        return [{ kind: 'external', addresses: INTERNET_ADDRESSES }];
      case 'cluster':
        return nodeEndpoints(input.nodes);
      case 'control-plane':
        return nodeEndpoints(input.nodes.filter((n) => n.controlPlane || n.witness));
      case 'object-store':
        return nodeEndpoints(input.nodes.filter((n) => n.objectStore));
      case 'ingress':
        return nodeEndpoints(input.nodes.filter((n) => n.ingress));
    }
  }

  if ('site' in peer) {
    const nodes = input.nodes.filter((n) => n.site === peer.site);

    if (nodes.length === 0)
      diagnostics.push({ level: 'warning', policy: policyId, message: `site ${peer.site} has no nodes` });

    return nodeEndpoints(nodes);
  }

  if ('selector' in peer) {
    const workloads = input.workloads.filter(
      (w) =>
        (!policy.project || w.project === policy.project) &&
        matchesSelector(peer.selector, { name: w.service, labels: w.labels }),
    );

    return workloadEndpoints(workloads);
  }

  if ('cidr' in peer) return [{ kind: 'external', addresses: [peer.cidr] }];

  if ('clients' in peer) {
    const members = clientGroupMembers(input, peer.clients);

    if (!members) {
      diagnostics.push({ level: 'error', policy: policyId, message: `unknown client group ${peer.clients}` });

      return [];
    }

    // Clients are located at the active gateway; without one they reach nothing.
    const gateway = input.remoteAccess?.active;
    const addresses = members.flatMap(clientAddresses);

    return gateway && addresses.length > 0 ? [{ kind: 'client', node: gateway, addresses }] : [];
  }

  return [];
}

export function policyKey(policy: NamedPolicy): string {
  return policy.project ? `${policy.project}/${policy.name}` : policy.name;
}
