import { matchesSelector, type HttpMatch, type PolicyPeer } from '@forepath/loadweaver/shared/util-model';

import { uniqueSorted } from './hash';
import { nodeAddresses, policyKey, workloadGroupMembers } from './resolve';
import type { CompilerInput, CompilerWorkload, Flow, MeshConfig, NamedPolicy } from './types';

/** Node-proxy ports (3.7): local workloads' service traffic in, proxy-to-proxy mTLS over the overlay. */
export const MESH_OUTBOUND_PORT = 15001;
export const MESH_INBOUND_PORT = 15443;
/** Port ranges up to this size are proxied port by port; wider ones stay direct (L3 / L4 only). */
const MAX_PROXIED_RANGE = 64;

/** `project/deployment/service`: the workload identity name of a service's replicas. */
export function serviceIdentity(w: Pick<CompilerWorkload, 'project' | 'deployment' | 'service'>): string {
  return `${w.project}/${w.deployment}/${w.service}`;
}

/** SNI of a service port on the proxies' inbound listener. */
export function meshSni(identity: string, port: number): string {
  const [project, deployment, service] = identity.split('/');

  return `${port}.${service}.${deployment}.${project}.mesh.lw`;
}

function expandPorts(ports: (string | number)[] | undefined): number[] | null {
  if (!ports?.length) return null;

  const result: number[] = [];

  for (const p of ports.map(String)) {
    const [from, to = from] = p.split('-').map(Number);

    if (to - from + 1 > MAX_PROXIED_RANGE) return null;

    for (let port = from; port <= to; port++) result.push(port);
  }

  return result;
}

/** The workloads a peer stands for; peers that aren't workloads (nodes, sites, CIDRs, builtins) give none. */
export function peerWorkloads(input: CompilerInput, policy: NamedPolicy, peer: PolicyPeer): CompilerWorkload[] {
  if ('group' in peer) {
    const project = peer.project ?? policy.project;

    return project ? (workloadGroupMembers(input, project, peer.group) ?? []) : [];
  }

  if ('selector' in peer)
    return input.workloads.filter(
      (w) =>
        (!policy.project || w.project === policy.project) &&
        matchesSelector(peer.selector, { name: w.service, labels: w.labels }),
    );

  return [];
}

/** A policy rule the mesh carries: TCP between workloads, with explicit (small enough) ports. */
function meshRule(policy: NamedPolicy, rule: NamedPolicy['spec']['rules'][number]): number[] | null {
  if (policy.builtin || rule.protocol !== 'tcp') return null;

  return expandPorts(rule.ports);
}

interface MeshEdge {
  policy: string;
  mode: 'enforce' | 'monitor';
  action: 'allow' | 'deny';
  source: CompilerWorkload;
  destination: CompilerWorkload;
  port: number;
  http?: HttpMatch;
}

function meshEdges(input: CompilerInput): MeshEdge[] {
  const edges: MeshEdge[] = [];

  for (const policy of input.policies) {
    // Hostname destinations are egress, not east-west.
    if (policy.spec.to.some((p) => 'host' in p)) continue;

    const sources = policy.spec.from.flatMap((p) => peerWorkloads(input, policy, p));
    const destinations = policy.spec.to.flatMap((p) => peerWorkloads(input, policy, p));

    for (const rule of policy.spec.rules) {
      const ports = meshRule(policy, rule);

      if (!ports) continue;

      for (const source of sources) {
        for (const destination of destinations) {
          if (source.id === destination.id) continue;

          for (const port of ports)
            edges.push({
              policy: policyKey(policy),
              mode: policy.spec.mode,
              action: policy.spec.action,
              source,
              destination,
              port,
              ...(rule.http ? { http: rule.http } : {}),
            });
        }
      }
    }
  }

  return edges;
}

/**
 * East-west through the node proxies (3.7): every allowed TCP flow with explicit ports between workloads goes
 * workload → its node's proxy → mTLS with workload identities → the destination node's proxy → replica, where the
 * L7 rules apply (deny wins). Returns the per-node proxy configuration and which flows the mesh replaces, so the
 * direct path isn't left open next to it.
 */
export function compileMesh(input: CompilerInput): { mesh: Map<string, MeshConfig>; meshed: (flow: Flow) => boolean } {
  const services = new Map(input.services.map((s) => [`${s.project}/${s.deployment}/${s.name}`, s.serviceIps]));
  // Interception happens on service IPs: services without one stay on the direct path.
  const edges = meshEdges(input).filter((e) => (services.get(serviceIdentity(e.destination)) ?? []).length > 0);
  const allows = edges.filter((e) => e.action === 'allow');
  const nodes = new Map(input.nodes.map((n) => [n.name, n]));
  const mesh = new Map<string, MeshConfig>();
  const config = (node: string): MeshConfig => {
    let c = mesh.get(node);

    if (!c) {
      c = { identities: [], outbound: [], upstreams: [], inbound: [] };
      mesh.set(node, c);
    }

    return c;
  };
  // Flows the mesh replaces: allow flows between workloads for the meshed (policy, port) pairs.
  const meshedKeys = new Set(
    allows.flatMap((e) =>
      e.source.addresses.flatMap((s) => e.destination.addresses.map((d) => `${e.policy}|${s}|${d}|${e.port}`)),
    ),
  );

  for (const edge of allows) {
    const identity = serviceIdentity(edge.destination);
    const serviceIps = services.get(identity) ?? [];
    const upstream = `${identity}:${edge.port}`;
    const sourceNode = config(edge.source.node);
    const sourceIdentity = serviceIdentity(edge.source);

    sourceNode.identities.push(sourceIdentity);

    for (const serviceIp of serviceIps) {
      for (const source of edge.source.addresses.filter((a) => a.includes(':') === serviceIp.includes(':'))) {
        if (!sourceNode.outbound.some((o) => o.source === source && o.serviceIp === serviceIp && o.port === edge.port))
          sourceNode.outbound.push({ source, identity: sourceIdentity, serviceIp, port: edge.port, upstream });
      }
    }

    // Every node running a (not draining) replica of the destination answers for it.
    const replicaNodes = uniqueSorted(
      input.workloads
        .filter((w) => serviceIdentity(w) === identity && !w.draining && !w.secondaryInterface)
        .map((w) => w.node),
    );
    let up = sourceNode.upstreams.find((u) => u.name === upstream);

    if (!up) {
      up = { name: upstream, sni: meshSni(identity, edge.port), identity, endpoints: [] };
      sourceNode.upstreams.push(up);
    }

    up.endpoints = uniqueSorted([
      ...up.endpoints,
      ...replicaNodes.flatMap((n) => {
        const node = nodes.get(n);

        return node ? nodeAddresses(node).slice(0, 1) : [];
      }),
    ]);

    const destinationNode = config(edge.destination.node);

    destinationNode.identities.push(identity);

    let inbound = destinationNode.inbound.find((i) => i.identity === identity && i.port === edge.port);

    if (!inbound) {
      inbound = { sni: meshSni(identity, edge.port), identity, port: edge.port, backends: [], http: false, rules: [] };
      destinationNode.inbound.push(inbound);
    }

    // A draining replica gets no new connections from its node's proxy either.
    if (!edge.destination.draining && !edge.destination.secondaryInterface)
      inbound.backends = uniqueSorted([...inbound.backends, ...edge.destination.addresses]);
  }

  // Rules per inbound service port: allows (with their L7 match) and L7 denies, which win.
  for (const edge of edges) {
    const identity = serviceIdentity(edge.destination);

    for (const [, c] of mesh) {
      const inbound = c.inbound.find((i) => i.identity === identity && i.port === edge.port);

      if (!inbound) continue;

      const rule = {
        identity: serviceIdentity(edge.source),
        policy: edge.policy,
        mode: edge.mode,
        action: edge.action,
        ...(edge.http ? { http: edge.http } : {}),
      };

      if (!inbound.rules.some((r) => JSON.stringify(r) === JSON.stringify(rule))) inbound.rules.push(rule);

      if (edge.http) inbound.http = true;
    }
  }

  for (const c of mesh.values()) {
    c.identities = uniqueSorted(c.identities);
    c.outbound.sort((a, b) =>
      `${a.source}|${a.serviceIp}|${a.port}`.localeCompare(`${b.source}|${b.serviceIp}|${b.port}`),
    );
    c.upstreams.sort((a, b) => a.name.localeCompare(b.name));
    c.inbound.sort((a, b) => a.sni.localeCompare(b.sni));
    c.inbound.forEach((i) =>
      i.rules.sort((a, b) =>
        `${a.action}|${a.identity}|${a.policy}`.localeCompare(`${b.action}|${b.identity}|${b.policy}`),
      ),
    );
  }

  // A flow is replaced when every port of it is carried by the mesh for its addresses.
  const meshed = (flow: Flow) => {
    const ports =
      flow.srcKind === 'workload' && flow.dstKind === 'workload' && flow.protocol === 'tcp'
        ? expandPorts(flow.ports)
        : null;

    return (
      !!ports &&
      flow.src.every((s) =>
        flow.dst.every(
          (d) =>
            s.includes(':') !== d.includes(':') || ports.every((p) => meshedKeys.has(`${flow.policy}|${s}|${d}|${p}`)),
        ),
      )
    );
  };

  return { mesh, meshed };
}
