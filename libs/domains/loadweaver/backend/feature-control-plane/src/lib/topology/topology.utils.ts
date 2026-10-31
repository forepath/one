import { createHash } from 'node:crypto';

import {
  describeSelector,
  matchesSelector,
  VM_DEPLOYMENT_NAME,
  type Selector,
} from '@forepath/loadweaver/shared/util-model';
import { workloadGroupMembers, type CompilerInput } from '@forepath/loadweaver/shared/util-policy-compiler';

/** One element of the map (3.9): sites ⊃ nodes ⊃ replicas, groups, volumes, hostnames, addresses, externals. */
export interface TopologyElement {
  id: string;
  kind: 'site' | 'node' | 'replica' | 'group' | 'volume' | 'hostname' | 'address' | 'external';
  label: string;
  /** Compound parent (site of a node, node of a replica). */
  parent?: string;
  project?: string | null;
  data: Record<string, unknown>;
}

/** Tunnels, policy edges, group membership, flows, volume copies, exposures, address holders. */
export interface TopologyEdge {
  id: string;
  kind: 'tunnel' | 'policy' | 'member' | 'flow' | 'volume' | 'exposure' | 'address';
  source: string;
  target: string;
  /** The layer the edge belongs to (the console toggles layers, 3.9). */
  layer: 'tunnels' | 'policies' | 'storage' | 'dns' | 'addressing';
  data: Record<string, unknown>;
}

export interface TopologyGraph {
  elements: TopologyElement[];
  edges: TopologyEdge[];
}

export interface TopologyExtras {
  health: ReadonlyMap<string, string>;
  /** Per node: WireGuard peers (node names) from the desired state. */
  tunnels: ReadonlyMap<string, string[]>;
  volumes: { id: string; primaryNode: string; syncReplicas: string[]; remoteReplicas: string[]; crossSite: string }[];
  addresses: { address: string; holder: string | null; owner: string | null }[];
  /** Hostnames and the services they reach (`project/deployment/service`). */
  hostnames: { host: string; services: string[] }[];
  replicaStates: ReadonlyMap<string, string>;
}

const replicaId = (id: string) => `replica:${id}`;
const nodeId = (name: string) => `node:${name}`;
const groupId = (project: string, name: string) => `group:${project}/${name}`;

/** The map's structure from the compiler input and live state (3.9). */
export function buildTopology(input: CompilerInput, extras: TopologyExtras): TopologyGraph {
  const elements: TopologyElement[] = [];
  const edges: TopologyEdge[] = [];
  const sites = [...new Set(input.nodes.map((n) => n.site))].sort();

  for (const site of sites)
    elements.push({
      id: `site:${site}`,
      kind: 'site',
      label: site,
      data: { health: extras.health.get(`site/${site}`) ?? 'unknown' },
    });

  for (const n of input.nodes)
    elements.push({
      id: nodeId(n.name),
      kind: 'node',
      label: n.name,
      parent: `site:${n.site}`,
      data: {
        health: extras.health.get(`node/${n.name}`) ?? 'unknown',
        controlPlane: n.controlPlane,
        witness: n.witness,
        ingress: !!n.ingress,
        overlay: [n.overlayV4, n.overlayV6].filter(Boolean),
      },
    });

  for (const w of input.workloads)
    elements.push({
      id: replicaId(w.id),
      kind: 'replica',
      label: `${w.service}/${w.id.split('/').at(-1)}`,
      parent: nodeId(w.node),
      project: w.project,
      data: {
        deployment: w.deployment,
        service: w.service,
        addresses: w.addresses,
        // Removed and draining (M6 gate): out of routing, stopped once its drain ends.
        state: w.draining ? 'draining' : (extras.replicaStates.get(w.id) ?? 'unknown'),
        ...(w.draining ? { draining: true } : {}),
        health: extras.health.get(`replica/${w.id}`) ?? 'unknown',
      },
    });

  // Groups: boxes on the map, membership as edges (a replica can be in several groups).
  for (const g of input.workloadGroups.filter((x) => !x.name.startsWith('expose:'))) {
    elements.push({
      id: groupId(g.project, g.name),
      kind: 'group',
      label: g.name,
      project: g.project,
      data: { exposed: !!g.spec.exposed },
    });

    for (const w of workloadGroupMembers(input, g.project, g.name) ?? [])
      edges.push({
        id: `member:${g.project}/${g.name}:${w.id}`,
        kind: 'member',
        source: groupId(g.project, g.name),
        target: replicaId(w.id),
        layer: 'policies',
        data: {},
      });
  }

  // Policy edges between groups (and sites, client groups and the outside world).
  const externals = new Map<string, TopologyElement>();
  const external = (label: string, kind = 'external'): string => {
    const id = `external:${kind === 'external' ? '' : `${kind}:`}${label}`;

    externals.set(id, { id, kind: 'external', label, data: { peer: kind } });

    return id;
  };
  const selectorGroups = new Set<string>();
  const peerId = (policyProject: string | undefined, peer: Record<string, unknown>): string | null => {
    if (typeof peer['group'] === 'string') {
      const project = (peer['project'] as string | undefined) ?? policyProject;

      return project ? groupId(project, peer['group']) : null;
    }

    if (typeof peer['site'] === 'string') return `site:${peer['site']}`;

    if (peer['selector'] && policyProject) {
      // An inline selector is an anonymous group of the policy's project: drawn as one, with its members.
      const selector = peer['selector'] as Selector;
      const name = `~${createHash('sha256').update(JSON.stringify(selector)).digest('hex').slice(0, 8)}`;
      const id = groupId(policyProject, name);

      if (!selectorGroups.has(id)) {
        selectorGroups.add(id);
        elements.push({
          id,
          kind: 'group',
          label: describeSelector(selector),
          project: policyProject,
          data: { exposed: false, selector: true },
        });

        for (const w of input.workloads.filter(
          (x) => x.project === policyProject && matchesSelector(selector, { name: x.service, labels: x.labels }),
        ))
          edges.push({
            id: `member:${policyProject}/${name}:${w.id}`,
            kind: 'member',
            source: id,
            target: replicaId(w.id),
            layer: 'policies',
            data: {},
          });
      }

      return id;
    }

    if (typeof peer['cidr'] === 'string') return external(peer['cidr']);

    if (typeof peer['host'] === 'string') return external(peer['host'], 'host');

    if (typeof peer['builtin'] === 'string') return external(peer['builtin'], 'builtin');

    if (typeof peer['clients'] === 'string') return external(peer['clients'], 'clients');

    return null;
  };

  for (const p of input.policies) {
    for (const from of p.spec.from as unknown as Record<string, unknown>[])
      for (const to of p.spec.to as unknown as Record<string, unknown>[]) {
        const source = peerId(p.project, from);
        const target = peerId(p.project, to);

        if (!source || !target) continue;

        edges.push({
          id: `policy:${p.project ?? ''}/${p.name}:${source}->${target}`,
          kind: 'policy',
          source,
          target,
          layer: 'policies',
          data: {
            policy: p.project ? `${p.project}/${p.name}` : p.name,
            mode: p.spec.mode,
            action: p.spec.action,
            rules: p.spec.rules,
            project: p.project ?? null,
          },
        });
      }
  }

  elements.push(...externals.values());

  // Tunnels between nodes, once per pair.
  const pairs = new Set<string>();

  for (const [node, peers] of extras.tunnels)
    for (const peer of peers) {
      const key = [node, peer].sort().join('|');

      if (pairs.has(key)) continue;

      pairs.add(key);
      edges.push({
        id: `tunnel:${key}`,
        kind: 'tunnel',
        source: nodeId(node),
        target: nodeId(peer),
        layer: 'tunnels',
        data: {},
      });
    }

  for (const v of extras.volumes) {
    const project = v.id.split('/')[0];

    elements.push({
      id: `volume:${v.id}`,
      kind: 'volume',
      label: v.id.split('/').at(-1) as string,
      project,
      data: { crossSite: v.crossSite, health: extras.health.get(`volume/${v.id}`) ?? 'unknown' },
    });

    for (const [node, role] of [
      [v.primaryNode, 'primary'],
      ...v.syncReplicas.map((n) => [n, 'sync'] as const),
      ...v.remoteReplicas.map((n) => [n, 'async'] as const),
    ] as const)
      edges.push({
        id: `volume:${v.id}:${node}`,
        kind: 'volume',
        source: `volume:${v.id}`,
        target: nodeId(node),
        layer: 'storage',
        data: { role },
      });
  }

  for (const h of extras.hostnames) {
    elements.push({ id: `hostname:${h.host}`, kind: 'hostname', label: h.host, data: {} });

    for (const service of h.services)
      for (const w of input.workloads.filter((x) => `${x.project}/${x.deployment}/${x.service}` === service))
        edges.push({
          id: `exposure:${h.host}:${w.id}`,
          kind: 'exposure',
          source: `hostname:${h.host}`,
          target: replicaId(w.id),
          layer: 'dns',
          data: { service },
        });
  }

  for (const a of extras.addresses) {
    elements.push({ id: `address:${a.address}`, kind: 'address', label: a.address, data: { owner: a.owner } });

    if (a.holder)
      edges.push({
        id: `address:${a.address}:${a.holder}`,
        kind: 'address',
        source: `address:${a.address}`,
        target: nodeId(a.holder),
        layer: 'addressing',
        data: {},
      });
  }

  return { elements, edges };
}

/**
 * What a caller sees (3.17): cluster roles everything; project members their projects' replicas, groups, volumes and
 * policy edges — no sites, nodes, tunnels or addresses (replicas lose their node parent).
 */
export function scopeTopology(graph: TopologyGraph, all: boolean, projects: ReadonlySet<string>): TopologyGraph {
  if (all) return graph;

  const elements = graph.elements
    .filter((e) => (e.project ? projects.has(e.project) : e.kind === 'external' || e.kind === 'hostname'))
    .map((e) => (e.kind === 'replica' ? { ...e, parent: undefined } : e));
  const visible = new Set(elements.map((e) => e.id));
  const edges = graph.edges.filter((e) => visible.has(e.source) && visible.has(e.target));
  // Hostnames and externals only where they connect to something visible.
  const connected = new Set(edges.flatMap((e) => [e.source, e.target]));

  return {
    elements: elements.filter((e) => (e.kind === 'external' || e.kind === 'hostname' ? connected.has(e.id) : true)),
    edges,
  };
}

/**
 * Flow edges (3.9 traffic): each side is a firewall set name (resolved with the reporting node's sets) or an address,
 * mapped to the element holding it (replica, node) or kept as an address. A set side spreads its counts over its
 * members (marked `estimated`), so totals stay right.
 */
export function flowEdges(
  flows: readonly {
    node: string;
    policy: string;
    src: string;
    dst: string;
    protocol: string;
    port: number;
    decision: string;
    packets: number;
    bytes: number;
  }[],
  sets: ReadonlyMap<string, ReadonlyMap<string, string[]>>,
  elementOfAddress: ReadonlyMap<string, string>,
  seconds: number,
): { edges: TopologyEdge[]; externals: TopologyElement[] } {
  const resolve = (node: string, endpoint: string): string[] => {
    const members = sets.get(node)?.get(endpoint) ?? [endpoint];

    return [
      ...new Set(
        members.map((a) => {
          const address = a.split('/')[0];

          return elementOfAddress.get(address) ?? `external:${address}`;
        }),
      ),
    ];
  };
  const merged = new Map<string, TopologyEdge>();
  const externals = new Map<string, TopologyElement>();

  for (const f of flows) {
    const sources = resolve(f.node, f.src);
    const targets = resolve(f.node, f.dst);
    const share = sources.length * targets.length;

    for (const source of sources)
      for (const target of targets) {
        for (const id of [source, target])
          if (id.startsWith('external:'))
            externals.set(id, { id, kind: 'external', label: id.slice('external:'.length), data: {} });

        const key = `flow:${source}->${target}:${f.protocol}/${f.port}:${f.decision}`;
        const edge = merged.get(key) ?? {
          id: key,
          kind: 'flow' as const,
          source,
          target,
          layer: 'policies' as const,
          data: {
            protocol: f.protocol,
            port: f.port,
            decision: f.decision,
            policy: f.policy || null,
            packets: 0,
            bytes: 0,
            estimated: false,
          },
        };

        edge.data['packets'] = (edge.data['packets'] as number) + f.packets / share;
        edge.data['bytes'] = (edge.data['bytes'] as number) + f.bytes / share;
        edge.data['bytesPerSecond'] = (edge.data['bytes'] as number) / Math.max(1, seconds);

        if (share > 1) edge.data['estimated'] = true;

        merged.set(key, edge);
      }
  }

  return { edges: [...merged.values()], externals: [...externals.values()] };
}

/** A plan change as the overlay needs it; `spec` (after, else before) only where the element id depends on it. */
export interface OverlayChange {
  action: string;
  kind: string;
  name: string;
  project: string | null;
  spec?: Record<string, unknown> | null;
}

/**
 * A plan over the map (3.9, 3.36 B1): which elements and edges it creates, changes or removes — groups, policy edges,
 * deployments (replicas + volumes), virtual machines (their `lw-vm` replica + disks), DNS records (hostnames, with
 * the zones' domains), nodes and sites.
 */
export function planOverlay(
  graph: TopologyGraph,
  changes: readonly OverlayChange[],
  context: { dnsZones?: ReadonlyMap<string, string> } = {},
): Record<string, 'create' | 'update' | 'delete'> {
  const overlay: Record<string, 'create' | 'update' | 'delete'> = {};
  const mark = (ids: Iterable<string>, action: 'create' | 'update' | 'delete') => {
    for (const id of ids) overlay[id] = action;
  };

  for (const c of changes.filter((x) => x.action === 'create' || x.action === 'update' || x.action === 'delete')) {
    const action = c.action as 'create' | 'update' | 'delete';

    if (c.kind === 'WorkloadGroup' && c.project) overlay[groupId(c.project, c.name)] = action;

    if (c.kind === 'Policy')
      mark(
        graph.edges
          .filter((x) => x.kind === 'policy' && x.data['policy'] === (c.project ? `${c.project}/${c.name}` : c.name))
          .map((e) => e.id),
        action,
      );

    if (c.kind === 'Deployment' && c.project) {
      mark(
        graph.elements
          .filter((x) => x.kind === 'replica' && x.project === c.project && x.data['deployment'] === c.name)
          .map((e) => e.id),
        action,
      );
      mark(
        graph.elements
          .filter((x) => x.kind === 'volume' && x.id.startsWith(`volume:${c.project}/${c.name}/`))
          .map((e) => e.id),
        action,
      );
    }

    if (c.kind === 'VirtualMachine' && c.project) {
      const replica = replicaId(`${c.project}/${VM_DEPLOYMENT_NAME}/${c.name}/0`);
      const disks = `volume:${c.project}/${VM_DEPLOYMENT_NAME}/${c.name}.`;

      overlay[replica] = action;
      mark(
        graph.elements.filter((x) => x.kind === 'volume' && x.id.startsWith(disks)).map((e) => e.id),
        action,
      );
    }

    if (c.kind === 'DnsRecord') {
      const zone = context.dnsZones?.get(String(c.spec?.['zone'] ?? ''));
      const name = c.spec?.['name'];

      if (zone && typeof name === 'string')
        overlay[`hostname:${(name === '@' ? zone : `${name}.${zone}`).toLowerCase().replace(/\.$/, '')}`] = action;
    }

    if (c.kind === 'Node') overlay[nodeId(c.name)] = action;

    if (c.kind === 'Site') overlay[`site:${c.name}`] = action;
  }

  return overlay;
}
