import {
  cidrAddress,
  cidrContains,
  cidrContainsIp,
  formatIp,
  mustParseCidr,
  parseCidr,
  parseIp,
  type Cidr,
} from '@forepath/loadweaver/shared/util-network';

import { buildFlows } from './flows';
import { compileEgressFilter, EGRESS_HTTP_PORT, EGRESS_TLS_PORT, offlineEgressSources } from './egress-filter';
import { compileMesh, MESH_INBOUND_PORT, MESH_OUTBOUND_PORT } from './mesh';
import { fnv1a, uniqueSorted } from './hash';
import { clientPrefixes, compileRemoteAccess, vpnGatewayAddress } from './remote-access';
import { clientAddresses, nodeAddresses } from './resolve';
import {
  DEFAULT_PLATFORM_PORTS,
  type BgpSession,
  type CompilationResult,
  type CompilerDiagnostic,
  type CompilerEgress,
  type CompilerInput,
  type CompilerNode,
  type EgressFilterConfig,
  type FirewallRule,
  type Flow,
  type MeshConfig,
  type NodeNetworkConfig,
  type PortAllocations,
  type WireguardLink,
} from './types';

const NAT_KEEPALIVE_SECONDS = 25;
const ROUTE_REFLECTORS_PER_SITE = 2;

/** Linux IFNAMSIZ is 16 incl. NUL: `lw-` + 8 hex = 11 characters. */
export function linkInterfaceName(peer: string): string {
  return `lw-${fnv1a(peer)}`;
}

function hostPrefix(address: string): string {
  if (address.includes('/')) return address;

  return address.includes(':') ? `${address}/128` : `${address}/32`;
}

/**
 * Picks route reflectors / site hubs once the cluster passes the threshold (3.34): per site up to two
 * nodes, keeping current reflectors while still eligible, then preferring control-plane nodes, then by name.
 */
export function selectRouteReflectors(input: CompilerInput): string[] {
  if (input.nodes.length < input.network.routeReflectorThreshold) return [];

  const current = new Set(input.routeReflectors ?? []);
  const bySite = new Map<string, CompilerNode[]>();

  for (const node of input.nodes) {
    if (node.witness || nodeAddresses(node).length === 0) continue;

    bySite.set(node.site, [...(bySite.get(node.site) ?? []), node]);
  }

  const selected: string[] = [];

  for (const nodes of bySite.values()) {
    const ranked = [...nodes].sort(
      (a, b) =>
        Number(current.has(b.name)) - Number(current.has(a.name)) ||
        Number(b.controlPlane) - Number(a.controlPlane) ||
        a.name.localeCompare(b.name),
    );

    selected.push(...ranked.slice(0, ROUTE_REFLECTORS_PER_SITE).map((n) => n.name));
  }

  return selected.sort();
}

/**
 * Large clusters route built-in node → control-plane traffic through the site's hubs, so the tunnel count grows
 * with policies instead of N² (3.34). Workload flows always stay direct.
 */
function routeViaHubs(flows: Flow[], nodes: Map<string, CompilerNode>, hubs: string[]): Flow[] {
  if (hubs.length === 0) return flows;

  const hubSet = new Set(hubs);

  return flows.map((flow) => {
    if (!flow.policy.startsWith('builtin:agent-api') || !flow.srcNode || !flow.dstNode) return flow;

    const src = nodes.get(flow.srcNode);

    if (!src || hubSet.has(src.name) || src.controlPlane || src.witness) return flow;

    const siteHubs = hubs.filter((h) => nodes.get(h)?.site === src.site && h !== flow.dstNode);
    // Deterministic spread over the site's hubs.
    const via =
      siteHubs.length > 0 ? siteHubs[parseInt(fnv1a(`${src.name}>${flow.dstNode}`), 16) % siteHubs.length] : undefined;

    return via ? { ...flow, via } : flow;
  });
}

const isV6 = (address: string) => address.includes(':');

const hostCidr = (address: string): Cidr =>
  mustParseCidr(address.includes('/') ? address : `${address}/${isV6(address) ? 128 : 32}`);

/**
 * Egress from own prefixes (3.27): a workload with an egress address sends what its egress policy covers (that
 * policy's destinations, per IP version) through the node holding the address (`via`). Its other flows to those
 * destinations go the same way, so the gateway forwards them too; flows to anything else stay on the source node.
 */
function routeViaEgress(flows: Flow[], egress: readonly CompilerEgress[]): Flow[] {
  if (egress.length === 0) return flows;

  const external = (f: Flow) => f.dstKind === 'external' && f.srcKind === 'workload' && !!f.srcNode;
  // Per source address: the gateway and the destinations its egress policy sends there.
  const gateways = new Map<string, { holder: string; destinations: Cidr[] }>();

  for (const flow of flows.filter(external)) {
    for (const entry of egress.filter((e) => e.policy === flow.policy)) {
      const v6 = isV6(entry.address);

      for (const src of flow.src.filter((a) => isV6(a) === v6)) {
        const gateway = gateways.get(src) ?? { holder: entry.holder, destinations: [] };

        gateway.destinations.push(...flow.dst.filter((d) => isV6(d) === v6).map(hostCidr));
        gateways.set(src, gateway);
      }
    }
  }

  return flows.flatMap((flow) => {
    if (!external(flow)) return [flow];

    const direct: string[] = [];
    const via = new Map<string, { src: string[]; dst: string[] }>();

    for (const src of flow.src) {
      const gateway = gateways.get(src);
      const dst = flow.dst.filter((d) => isV6(d) === isV6(src));
      const covered =
        !!gateway &&
        gateway.holder !== flow.srcNode &&
        dst.length > 0 &&
        dst.every((d) => gateway.destinations.some((c) => cidrContains(c, hostCidr(d))));

      if (!covered || !gateway) {
        direct.push(src);
        continue;
      }

      const key = `${gateway.holder}|${isV6(src) ? 6 : 4}`;
      const group = via.get(key) ?? { src: [], dst };

      group.src.push(src);
      via.set(key, group);
    }

    return [
      ...(direct.length > 0 ? [{ ...flow, src: direct }] : []),
      ...[...via].map(([key, group]) => ({ ...flow, src: group.src, dst: group.dst, via: key.split('|')[0] })),
    ];
  });
}

interface LinkDraft {
  allowed: Set<string>;
  reasons: Set<string>;
}

function linkDraft(drafts: Map<string, Map<string, LinkDraft>>, node: string, peer: string): LinkDraft {
  let perNode = drafts.get(node);

  if (!perNode) {
    perNode = new Map();
    drafts.set(node, perNode);
  }

  let draft = perNode.get(peer);

  if (!draft) {
    draft = { allowed: new Set(), reasons: new Set() };
    perNode.set(peer, draft);
  }

  return draft;
}

/** Records that `node` exchanges `remote` addresses with `peer` over a direct link. */
function addHop(
  drafts: Map<string, Map<string, LinkDraft>>,
  node: string,
  peer: string,
  remote: string[],
  reason: string,
): void {
  const draft = linkDraft(drafts, node, peer);

  remote.forEach((a) => draft.allowed.add(hostPrefix(a)));
  draft.reasons.add(reason);
}

function allocatePorts(
  nodes: string[],
  drafts: Map<string, Map<string, LinkDraft>>,
  previous: PortAllocations,
  base: number,
  reserved: ReadonlyMap<string, readonly number[]> = new Map(),
): PortAllocations {
  const result: PortAllocations = {};

  for (const node of nodes) {
    const peers = [...(drafts.get(node)?.keys() ?? [])].sort();
    const kept: Record<string, number> = {};
    // Ports the host uses itself (3.21) are never handed out, not even kept from an earlier allocation.
    const used = new Set<number>(reserved.get(node) ?? []);

    for (const peer of peers) {
      const port = previous[node]?.[peer];

      if (port !== undefined && !used.has(port)) {
        kept[peer] = port;
        used.add(port);
      }
    }

    let next = base;

    for (const peer of peers) {
      if (kept[peer] !== undefined) continue;

      while (used.has(next)) next++;

      kept[peer] = next;
      used.add(next);
    }

    result[node] = kept;
  }

  return result;
}

function podSubnets(node: CompilerNode): string[] {
  return [node.podSubnetV4, node.podSubnetV6].filter((s): s is string => !!s);
}

function addressInSubnets(address: string, subnets: string[]): boolean {
  const ip = parseIp(address.split('/')[0]);

  return (
    !!ip &&
    subnets.some((s) => {
      const cidr = parseCidr(s);

      return !!cidr && cidrContainsIp(cidr, ip);
    })
  );
}

class SetRegistry {
  readonly sets: Record<string, string[]> = {};

  name(addresses: string[]): string {
    const members = uniqueSorted(addresses.map(hostPrefix));
    const name = `lw_${fnv1a(members.join(','))}`;

    this.sets[name] = members;

    return name;
  }
}

/**
 * Compiles groups and policies into the per-node configuration of every enforcement layer (3.3):
 * WireGuard links and AllowedIPs, BIRD sessions and filters, nftables sets and rules, DNS visibility.
 * The result contains only what policies require: no policy, no tunnel, no route, no rule.
 */
export function compileNetwork(input: CompilerInput): CompilationResult {
  const diagnostics: CompilerDiagnostic[] = [];
  const ports = { ...DEFAULT_PLATFORM_PORTS, ...input.platformPorts };
  const nodes = new Map(input.nodes.map((n) => [n.name, n]));
  const routeReflectors = selectRouteReflectors(input);
  const { flows: rawFlows } = buildFlows(input, diagnostics);
  // East-west through the node proxies (3.7): meshed flows leave the direct path; the proxies talk to each other.
  const { mesh, meshed } = compileMesh(input);
  // HTTP matches are only checked by the proxies: a rule the mesh can't carry (no or wide ports, UDP, sources that
  // aren't workloads, services without a service IP) would otherwise allow all of it at L4. Fail closed.
  const l7Unmeshed = (f: Flow) => !!f.l7 && !meshed(f);

  for (const policy of new Set(rawFlows.filter(l7Unmeshed).map((f) => f.policy)))
    diagnostics.push({
      level: 'warning',
      policy,
      message:
        'http matches need TCP with explicit ports (at most 64) between workloads and a service with a service IP; the rule does not apply elsewhere',
    });

  const routed = routeViaEgress(
    routeViaHubs(
      rawFlows.filter((f) => !l7Unmeshed(f)),
      nodes,
      routeReflectors,
    ),
    input.egress ?? [],
  );
  const egressFilter = compileEgressFilter(input, routed, diagnostics);
  // `offline` (3.7, cluster-wide or per workload by policy): workloads reach nothing outside the cluster, whatever the
  // L3 policies say.
  const offline = offlineEgressSources(input);
  const flows = [
    ...routed.flatMap((f) => {
      if (meshed(f)) return [];

      if (f.srcKind !== 'workload' || f.dstKind !== 'external') return [f];

      const src = f.src.filter((a) => !offline(a));

      return src.length === 0 ? [] : [src.length === f.src.length ? f : { ...f, src }];
    }),
    ...meshFlows(mesh, nodes),
  ];

  // 1. Tunnels: one link per node pair that has to exchange traffic.
  const drafts = new Map<string, Map<string, LinkDraft>>();

  for (const flow of flows) {
    // Through an egress gateway: everything outside the cluster towards it, the sources back.
    if (flow.via && flow.srcNode && !flow.dstNode) {
      addHop(drafts, flow.srcNode, flow.via, flow.dst, flow.policy);
      addHop(drafts, flow.via, flow.srcNode, flow.src, flow.policy);
      continue;
    }

    if (!flow.srcNode || !flow.dstNode || flow.srcNode === flow.dstNode) continue;

    if (flow.via) {
      addHop(drafts, flow.srcNode, flow.via, flow.dst, flow.policy);
      addHop(drafts, flow.via, flow.srcNode, flow.src, flow.policy);
      addHop(drafts, flow.via, flow.dstNode, flow.dst, flow.policy);
      addHop(drafts, flow.dstNode, flow.via, flow.src, flow.policy);
    } else {
      addHop(drafts, flow.srcNode, flow.dstNode, flow.dst, flow.policy);
      addHop(drafts, flow.dstNode, flow.srcNode, flow.src, flow.policy);
    }
  }

  // Route reflection: clients keep a session to their site's reflectors, reflectors mesh with each other.
  const sessionPairs = new Set<string>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  if (routeReflectors.length > 0) {
    for (const node of input.nodes) {
      if (node.witness || nodeAddresses(node).length === 0) continue;

      const targets = routeReflectors.includes(node.name)
        ? routeReflectors.filter((rr) => rr !== node.name)
        : routeReflectors.filter((rr) => nodes.get(rr)?.site === node.site);

      for (const target of targets) {
        sessionPairs.add(pairKey(node.name, target));
        addHop(drafts, node.name, target, [], 'builtin:route-reflection');
        addHop(drafts, target, node.name, [], 'builtin:route-reflection');
      }
    }
  } else {
    for (const [node, peers] of drafts) for (const peer of peers.keys()) sessionPairs.add(pairKey(node, peer));
  }

  // Every link carries the overlay addresses of both ends (BGP session, next-hop resolution).
  for (const [node, peers] of drafts) {
    for (const [peer, draft] of peers) {
      const remote = nodes.get(peer);

      if (remote) nodeAddresses(remote).forEach((a) => draft.allowed.add(hostPrefix(a)));

      if (!nodes.get(node)?.endpointHost && !remote?.endpointHost && node < peer) {
        diagnostics.push({
          level: 'error',
          message: `nodes ${node} and ${peer} are both behind NAT; at least one side needs a reachable WireGuard endpoint`,
        });
      }
    }
  }

  const allocations = allocatePorts(
    [...nodes.keys()],
    drafts,
    input.portAllocations ?? {},
    ports.wireguardBase,
    new Map(input.nodes.filter((n) => n.reservedUdpPorts?.length).map((n) => [n.name, n.reservedUdpPorts ?? []])),
  );

  // 2. Routing: which prefixes each node exports to whom. The active remote access gateway routes the client
  // prefixes like its pod subnets (3.31).
  const vpnPrefixes = clientPrefixes(input);
  // Addresses kept by live-migrated replicas (3.10) are routed to the node running them as host routes.
  const keptPrefixes = new Map<string, string[]>();

  for (const w of input.workloads)
    if (w.keptAddresses?.length)
      keptPrefixes.set(w.node, [...(keptPrefixes.get(w.node) ?? []), ...w.keptAddresses.map(hostPrefix)]);

  const routedPrefixes = (node: CompilerNode) => [
    ...podSubnets(node),
    ...(keptPrefixes.get(node.name) ?? []),
    ...(node.name === input.remoteAccess?.active ? vpnPrefixes : []),
  ];
  const podLike = (kind: Flow['srcKind']) => kind === 'workload' || kind === 'client';
  const workloadPeers = new Map<string, Set<string>>();

  for (const flow of flows) {
    // The egress gateway routes answers back to the sources' pod subnets.
    if (flow.via && flow.srcNode && !flow.dstNode) {
      workloadPeers.set(flow.srcNode, (workloadPeers.get(flow.srcNode) ?? new Set()).add(flow.via));
      workloadPeers.set(flow.via, (workloadPeers.get(flow.via) ?? new Set()).add(flow.srcNode));
      continue;
    }

    if (!flow.srcNode || !flow.dstNode || flow.srcNode === flow.dstNode) continue;

    if (!podLike(flow.srcKind) && !podLike(flow.dstKind)) continue;

    workloadPeers.set(flow.srcNode, (workloadPeers.get(flow.srcNode) ?? new Set()).add(flow.dstNode));
    workloadPeers.set(flow.dstNode, (workloadPeers.get(flow.dstNode) ?? new Set()).add(flow.srcNode));
  }

  const result: Record<string, NodeNetworkConfig> = {};

  for (const node of input.nodes) {
    const links: WireguardLink[] = [];

    for (const [peer, draft] of [...(drafts.get(node.name)?.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b))) {
      const remote = nodes.get(peer);

      if (!remote) continue;

      const peerPort = allocations[peer]?.[node.name];

      links.push({
        interface: linkInterfaceName(peer),
        listenPort: allocations[node.name][peer],
        peer,
        peerPublicKey: remote.wireguardPublicKey,
        peerEndpoint:
          remote.endpointHost && peerPort
            ? `${remote.endpointHost.includes(':') ? `[${remote.endpointHost}]` : remote.endpointHost}:${peerPort}`
            : undefined,
        allowedIps: uniqueSorted(draft.allowed),
        persistentKeepalive: node.endpointHost ? undefined : NAT_KEEPALIVE_SECONDS,
        addresses: nodeAddresses(node).map(hostPrefix),
        peerAddresses: nodeAddresses(remote),
        reasons: uniqueSorted(draft.reasons),
      });
    }

    const ownPrefixes = [...routedPrefixes(node), ...nodeAddresses(node).map(hostPrefix)];
    const sessions: BgpSession[] = [];
    const isReflector = routeReflectors.includes(node.name);

    for (const link of links) {
      if (!sessionPairs.has(pairKey(node.name, link.peer))) continue;

      const remote = nodes.get(link.peer);

      if (!remote) continue;

      const remoteAddress = remote.overlayV6 ?? remote.overlayV4;

      if (!remoteAddress) continue;

      const peerIsReflector = routeReflectors.includes(link.peer);
      const needsPods = (a: string, b: string) => workloadPeers.get(a)?.has(b) ?? false;
      let exports: string[];
      let imports: string[];

      if (isReflector && !peerIsReflector) {
        // Reflector → client: only what the client's policies need (filtered reflection).
        exports = input.nodes
          .filter((o) => o.name !== link.peer && needsPods(link.peer, o.name))
          .flatMap(routedPrefixes);
        exports.push(
          ...input.nodes.filter((o) => o.name !== link.peer).flatMap((o) => nodeAddresses(o).map(hostPrefix)),
        );
        imports = [...routedPrefixes(remote), ...nodeAddresses(remote).map(hostPrefix)];
      } else if (!isReflector && peerIsReflector) {
        // Client → reflector: everything this node originates; the reflector filters per client.
        exports = ownPrefixes;
        imports = input.nodes
          .filter((o) => o.name !== node.name && needsPods(node.name, o.name))
          .flatMap(routedPrefixes);
        imports.push(
          ...input.nodes.filter((o) => o.name !== node.name).flatMap((o) => nodeAddresses(o).map(hostPrefix)),
        );
      } else if (isReflector && peerIsReflector) {
        exports = input.nodes
          .filter((o) => o.name !== link.peer)
          .flatMap((o) => [...routedPrefixes(o), ...nodeAddresses(o).map(hostPrefix)]);
        imports = input.nodes
          .filter((o) => o.name !== node.name)
          .flatMap((o) => [...routedPrefixes(o), ...nodeAddresses(o).map(hostPrefix)]);
      } else {
        // Direct peering: pod subnets only where workload policies connect the two nodes.
        const pods = needsPods(node.name, link.peer);

        exports = [...(pods ? routedPrefixes(node) : []), ...nodeAddresses(node).map(hostPrefix)];
        imports = [...(pods ? routedPrefixes(remote) : []), ...nodeAddresses(remote).map(hostPrefix)];
      }

      sessions.push({
        peer: link.peer,
        interface: link.interface,
        peerAddress: remoteAddress,
        peerAddresses: nodeAddresses(remote),
        role:
          peerIsReflector && !isReflector
            ? 'route-reflector'
            : isReflector && !peerIsReflector
              ? 'route-reflector-client'
              : 'peer',
        exports: uniqueSorted(exports),
        imports: uniqueSorted(imports),
      });
    }

    result[node.name] = {
      node: node.name,
      addresses: nodeAddresses(node),
      wireguard: links,
      services: [],
      bgp: {
        asn: input.network.asn,
        routerId: node.overlayV4 ?? routerIdFromName(node.name),
        routeReflector: isReflector,
        originate: uniqueSorted(ownPrefixes),
        sessions,
      },
      firewall: { sets: {}, rules: [] },
      dns: { domain: input.network.dnsDomain, records: [], visibility: {} },
    };
  }

  // 3. Filtering: stateful allow rules on both ends of every flow (defense in depth).
  const registries = new Map(input.nodes.map((n) => [n.name, new SetRegistry()]));
  const ruleIds = new Map<string, Set<string>>();

  const addRule = (nodeName: string, flow: Flow, chain: FirewallRule['chain']) => {
    const registry = registries.get(nodeName);
    const config = result[nodeName];

    if (!registry || !config) return;

    const srcSet = registry.name(flow.src);
    const dstSet = registry.name(flow.dst);
    const key = `${flow.policy}|${chain}|${srcSet}|${dstSet}|${flow.protocol}|${flow.ports.join(',')}|${flow.mode}`;
    const seen = ruleIds.get(nodeName) ?? new Set();

    if (seen.has(key)) return;

    seen.add(key);
    ruleIds.set(nodeName, seen);
    config.firewall.rules.push({
      id: `${flow.policy}#${fnv1a(key)}`,
      policy: flow.policy,
      chain,
      srcSet,
      dstSet,
      protocol: flow.protocol,
      ports: flow.ports,
      action: flow.mode === 'monitor' ? 'observe' : 'accept',
    });
  };

  for (const flow of flows) {
    if (flow.dstNode) addRule(flow.dstNode, flow, flow.dstKind === 'node' ? 'input' : 'forward');

    if (flow.srcNode && flow.srcNode !== flow.dstNode)
      addRule(flow.srcNode, flow, flow.srcKind === 'node' ? 'output' : 'forward');

    if (flow.via) addRule(flow.via, flow, 'forward');
  }

  for (const [name, registry] of registries) {
    if (result[name]) result[name].firewall.sets = registry.sets;
  }

  // BGP sessions themselves are built-in traffic on each link.
  for (const config of Object.values(result)) {
    for (const session of config.bgp.sessions) {
      const own = nodes.get(config.node);

      if (!own) continue;

      const registry = registries.get(config.node);

      if (!registry) continue;

      const peerSet = registry.name(session.peerAddresses.length > 0 ? session.peerAddresses : [session.peerAddress]);
      const ownSet = registry.name(nodeAddresses(own));
      const bgpRule = (chain: 'input' | 'output', srcSet: string, dstSet: string): FirewallRule => ({
        id: `builtin:bgp#${fnv1a(`${config.node}|${session.peer}|${chain}`)}`,
        policy: 'builtin:bgp',
        chain,
        srcSet,
        dstSet,
        protocol: 'tcp',
        ports: [String(ports.bgp)],
        action: 'accept',
      });

      // Either side may open the session.
      config.firewall.rules.push(bgpRule('input', peerSet, ownSet), bgpRule('output', ownSet, peerSet));
      config.firewall.sets = registry.sets;
    }
  }

  compileEgress(input.egress ?? [], flows, result, diagnostics);
  addMeshRules(mesh, nodes, result, registries);
  addEgressFilterRules(egressFilter, nodes, result, registries, input);
  // Who may reach which service doesn't depend on the path: DNS and service IPs from all policy flows.
  const clientViews = compileDnsAndServices(input, routed, result);
  const clients = compileRemoteAccess(
    input,
    flows,
    result,
    clientViews,
    (name, partial, src, dst) => {
      const registry = registries.get(name);
      const target = result[name];

      if (!registry || !target) return;

      const srcSet = registry.name(src);
      const dstSet = registry.name(dst);

      target.firewall.rules.push({
        ...partial,
        id: `${partial.policy}#${fnv1a(`${name}|${partial.chain}|${srcSet}|${dstSet}|${partial.protocol}|${partial.ports.join(',')}`)}`,
        srcSet,
        dstSet,
      });
      target.firewall.sets = registry.sets;
    },
    diagnostics,
  );

  return { nodes: result, flows, portAllocations: allocations, routeReflectors, diagnostics, clients };
}

/**
 * Egress routes on the sources' nodes and source NAT on the gateways (3.27). A workload can leave with one address
 * per family only: two egress policies giving it different ones are an error.
 */
function compileEgress(
  egress: readonly CompilerEgress[],
  flows: readonly Flow[],
  result: Record<string, NodeNetworkConfig>,
  diagnostics: CompilerDiagnostic[],
): void {
  const owner = new Map<string, string>();

  for (const entry of egress) {
    const policyFlows = flows.filter(
      (f) => f.policy === entry.policy && f.dstKind === 'external' && f.srcKind === 'workload',
    );
    const sources = uniqueSorted(policyFlows.flatMap((f) => f.src).filter((a) => isV6(a) === isV6(entry.address)));
    const gateway = result[entry.holder];

    for (const source of sources) {
      const previous = owner.get(source);

      if (previous && previous !== entry.address)
        diagnostics.push({
          level: 'error',
          policy: entry.policy,
          message: `${source} would leave with both ${previous} and ${entry.address}; one egress address per workload`,
        });

      owner.set(source, entry.address);
    }

    if (!gateway || sources.length === 0) continue;

    gateway.egress ??= { routes: [], snat: [] };
    gateway.egress.snat.push({ address: entry.address, sources });
  }

  // Routes on the sources' nodes: per gateway link, which sources and which destinations go there.
  for (const flow of flows) {
    if (!flow.via || flow.dstNode || !flow.srcNode || flow.dstKind !== 'external') continue;

    const config = result[flow.srcNode];

    if (!config) continue;

    const iface = linkInterfaceName(flow.via);

    config.egress ??= { routes: [], snat: [] };

    const route = config.egress.routes.find((r) => r.interface === iface);

    if (route) {
      route.sources = uniqueSorted([...route.sources, ...flow.src]);
      route.destinations = uniqueSorted([...route.destinations, ...flow.dst]);
    } else {
      config.egress.routes.push({
        interface: iface,
        sources: uniqueSorted(flow.src),
        destinations: uniqueSorted(flow.dst),
      });
    }
  }

  for (const config of Object.values(result)) {
    if (!config.egress) continue;

    config.egress.routes.sort((a, b) => a.interface.localeCompare(b.interface));
    config.egress.snat = config.egress.snat
      .reduce<{ address: string; sources: string[] }[]>((merged, s) => {
        const same = merged.find((m) => m.address === s.address);

        if (same) same.sources = uniqueSorted([...same.sources, ...s.sources]);
        else merged.push({ ...s });

        return merged;
      }, [])
      .sort((a, b) => a.address.localeCompare(b.address));
  }
}

/** Proxy-to-proxy traffic: from every node with outbound mesh traffic to the nodes answering for it. */
function meshFlows(mesh: ReadonlyMap<string, MeshConfig>, nodes: ReadonlyMap<string, CompilerNode>): Flow[] {
  const flows: Flow[] = [];

  for (const [node, config] of mesh) {
    const source = nodes.get(node);

    if (!source) continue;

    const targets = new Map<string, string[]>();

    for (const endpoint of config.upstreams.flatMap((u) => u.endpoints)) {
      const target = [...nodes.values()].find((n) => nodeAddresses(n).includes(endpoint));

      if (target && target.name !== node) targets.set(target.name, nodeAddresses(target));
    }

    for (const [target, addresses] of targets)
      flows.push({
        policy: 'builtin:mesh',
        mode: 'enforce',
        srcNode: node,
        dstNode: target,
        srcKind: 'node',
        dstKind: 'node',
        src: nodeAddresses(source),
        dst: addresses,
        protocol: 'tcp',
        ports: [String(MESH_INBOUND_PORT)],
      });
  }

  return flows;
}

/** The node's own pod gateway addresses (first address of each pod subnet): where local workloads reach the proxy. */
export function podGateways(node: CompilerNode): string[] {
  return podSubnets(node).map((s) => formatIp(cidrAddress(mustParseCidr(s), BigInt(1))));
}

/** Local rules of the mesh: workloads → their proxy, the proxy → local replicas. */
function addMeshRules(
  mesh: ReadonlyMap<string, MeshConfig>,
  nodes: ReadonlyMap<string, CompilerNode>,
  result: Record<string, NodeNetworkConfig>,
  registries: Map<string, SetRegistry>,
): void {
  for (const [name, config] of mesh) {
    const node = nodes.get(name);
    const registry = registries.get(name);
    const target = result[name];

    if (!node || !registry || !target) continue;

    target.mesh = config;

    const gateways = podGateways(node);
    const rule = (chain: FirewallRule['chain'], src: string[], dst: string[], ports: string[]): FirewallRule => {
      const srcSet = registry.name(src);
      const dstSet = registry.name(dst);

      return {
        id: `builtin:mesh#${fnv1a(`${name}|${chain}|${srcSet}|${dstSet}|${ports.join(',')}`)}`,
        policy: 'builtin:mesh',
        chain,
        srcSet,
        dstSet,
        protocol: 'tcp',
        ports,
        action: 'accept',
      };
    };
    const sources = uniqueSorted(config.outbound.map((o) => o.source));

    if (sources.length > 0) target.firewall.rules.push(rule('input', sources, gateways, [String(MESH_OUTBOUND_PORT)]));

    for (const inbound of config.inbound)
      target.firewall.rules.push(rule('output', gateways, inbound.backends, [String(inbound.port)]));

    target.firewall.sets = registry.sets;
  }
}

/** Egress filtering: the configuration per node, and its workloads reaching the proxy's web listeners. */
function addEgressFilterRules(
  filters: ReadonlyMap<string, EgressFilterConfig>,
  nodes: ReadonlyMap<string, CompilerNode>,
  result: Record<string, NodeNetworkConfig>,
  registries: Map<string, SetRegistry>,
  input: CompilerInput,
): void {
  for (const [name, config] of filters) {
    const node = nodes.get(name);
    const registry = registries.get(name);
    const target = result[name];

    if (!node || !registry || !target) continue;

    target.egressFilter = config;

    // Remote clients reach the listeners on the gateway's client-network address (3.31).
    const vpn =
      input.remoteAccess && input.remoteAccess.active === name
        ? [vpnGatewayAddress(input.remoteAccess.clientNetwork).split('/')[0]]
        : [];
    const srcSet = registry.name(config.sources.map((s) => s.address));
    const dstSet = registry.name([...podGateways(node), ...vpn]);
    const ports = [String(EGRESS_HTTP_PORT), String(EGRESS_TLS_PORT)];

    target.firewall.rules.push({
      id: `builtin:egress-filter#${fnv1a(`${name}|${srcSet}|${dstSet}`)}`,
      policy: 'builtin:egress-filter',
      chain: 'input',
      srcSet,
      dstSet,
      protocol: 'tcp',
      ports,
      action: 'accept',
    });
    target.firewall.sets = registry.sets;
  }
}

/** `<service>.<deployment>.<project>.<domain>`; workloads search their own deployment, so compose names work (3.4). */
export function serviceDnsName(service: { name: string; deployment: string; project: string }, domain: string): string {
  return `${service.name}.${service.deployment}.${service.project}.${domain}`;
}

/** IPv6-only nodes still need a 32-bit BGP router id. */
function routerIdFromName(name: string): string {
  const h = parseInt(fnv1a(name), 16);

  return [h >>> 24, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff].join('.');
}

/**
 * Policy-aware DNS and service NAT (3.4): a client only resolves services it may reach, and a service IP only
 * forwards to replicas the client node may reach.
 */
function compileDnsAndServices(
  input: CompilerInput,
  flows: Flow[],
  result: Record<string, NodeNetworkConfig>,
): Map<string, { names: string[]; serviceIps: string[] }> {
  const domain = input.network.dnsDomain;
  const workloadsByService = new Map<string, typeof input.workloads>();

  for (const workload of input.workloads) {
    // Draining replicas take no new connections through service IPs.
    if (workload.draining) continue;

    const key = `${workload.project}/${workload.service}`;

    workloadsByService.set(key, [...(workloadsByService.get(key) ?? []), workload]);
  }

  // reachable[clientAddress] = addresses it may open connections to.
  const reachable = new Map<string, Set<string>>();

  for (const flow of flows) {
    if (flow.srcKind !== 'workload' && flow.srcKind !== 'client') continue;

    for (const src of flow.src) {
      const set = reachable.get(src) ?? new Set<string>();

      flow.dst.forEach((d) => set.add(d));
      reachable.set(src, set);
    }
  }

  const covers = (allowed: Set<string> | undefined, address: string) =>
    !!allowed && (allowed.has(address) || [...allowed].some((a) => a.includes('/') && addressInSubnets(address, [a])));

  // Remote clients resolve and use service IPs on the active gateway like its workloads (3.31).
  const gateway = input.remoteAccess?.active;
  const consumers = [
    ...input.workloads.map((w) => ({ id: w.id, node: w.node, addresses: w.addresses, dnsAddresses: w.addresses })),
    ...(gateway
      ? (input.remoteAccess?.clients ?? []).map((c) => ({
          id: `client:${c.id}`,
          node: gateway,
          addresses: clientAddresses(c),
          dnsAddresses: [c.address],
        }))
      : []),
  ];
  const clientViews = new Map<string, { names: string[]; serviceIps: string[] }>();

  for (const workload of consumers) {
    const config = result[workload.node];

    if (!config) continue;

    for (const service of input.services) {
      const backends = (workloadsByService.get(`${service.project}/${service.name}`) ?? []).filter(
        (b) => b.id !== workload.id,
      );
      const reachableBackends = backends
        .flatMap((b) => b.addresses)
        .filter((addr) => workload.addresses.some((src) => covers(reachable.get(src), addr)));

      if (reachableBackends.length === 0 || service.serviceIps.length === 0) continue;

      const name = serviceDnsName(service, domain);

      for (const src of workload.dnsAddresses) {
        config.dns.visibility[src] = uniqueSorted([...(config.dns.visibility[src] ?? []), name]);
      }

      if (workload.id.startsWith('client:')) {
        const view = clientViews.get(workload.dnsAddresses[0]) ?? { names: [], serviceIps: [] };

        view.names = uniqueSorted([...view.names, name]);
        view.serviceIps = uniqueSorted([...view.serviceIps, ...service.serviceIps]);
        clientViews.set(workload.dnsAddresses[0], view);
      }

      if (!config.dns.records.some((r) => r.name === name))
        config.dns.records.push({ name, addresses: [...service.serviceIps].sort() });

      for (const serviceIp of service.serviceIps) {
        const family = serviceIp.includes(':') ? 6 : 4;
        const sameFamily = reachableBackends.filter((b) => (b.includes(':') ? 6 : 4) === family);
        const existing = config.services.find((s) => s.serviceIp === serviceIp);

        if (sameFamily.length === 0) continue;

        if (existing) existing.backends = uniqueSorted([...existing.backends, ...sameFamily]);
        else config.services.push({ name, serviceIp, backends: uniqueSorted(sameFamily) });
      }
    }
  }

  for (const config of Object.values(result)) {
    config.dns.records.sort((a, b) => a.name.localeCompare(b.name));
    config.services.sort((a, b) => a.serviceIp.localeCompare(b.serviceIp));
  }

  return clientViews;
}
