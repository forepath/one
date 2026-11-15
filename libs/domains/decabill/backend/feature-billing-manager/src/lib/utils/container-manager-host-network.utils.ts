export type ContainerManagerTopologyNodeKind =
  | 'container'
  | 'network'
  | 'exit'
  | 'route'
  | 'host_iface'
  | 'host_gateway'
  | 'internet';

export interface HostInterfaceInfo {
  name: string;
  state: string;
  addresses: string[];
}

export interface HostRouteInfo {
  destination: string;
  gateway?: string;
  device?: string;
}

export interface TopologyNodeInput {
  id: string;
  label: string;
  kind: ContainerManagerTopologyNodeKind;
}

export interface TopologyEdgeInput {
  id: string;
  from: string;
  to: string;
  label?: string;
}

interface IpAddrEntry {
  ifname?: string;
  operstate?: string;
  addr_info?: Array<{ local?: string; prefixlen?: number; family?: string }>;
}

interface IpRouteNexthop {
  gateway?: string;
  dev?: string;
}

interface IpRouteEntry {
  dst?: string;
  gateway?: string;
  dev?: string;
  nexthops?: IpRouteNexthop[];
}

function isDefaultDestination(destination: string): boolean {
  return destination === 'default' || destination === '0.0.0.0/0' || destination === '::/0';
}

/** Parse `ip -j addr` stdout into host interface records. */
export function parseIpAddrJson(raw: string): HostInterfaceInfo[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const interfaces: HostInterfaceInfo[] = [];

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const row = entry as IpAddrEntry;
    const name = typeof row.ifname === 'string' ? row.ifname.trim() : '';

    if (!name || name === 'lo') {
      continue;
    }

    const addresses = (row.addr_info ?? [])
      .filter((info) => info && (info.family === 'inet' || info.family === 'inet6') && typeof info.local === 'string')
      .map((info) => {
        const local = String(info.local);
        const prefix = typeof info.prefixlen === 'number' ? info.prefixlen : null;

        return prefix != null ? `${local}/${prefix}` : local;
      });

    interfaces.push({
      name,
      state: typeof row.operstate === 'string' ? row.operstate : 'unknown',
      addresses,
    });
  }

  return interfaces;
}

function pushRoute(
  routes: HostRouteInfo[],
  destination: string,
  gateway: string | undefined,
  device: string | undefined,
): void {
  if (!gateway && !device && isDefaultDestination(destination)) {
    return;
  }

  routes.push({ destination, gateway, device });
}

/** Parse `ip -j route` stdout into host route records (including nexthops). */
export function parseIpRouteJson(raw: string): HostRouteInfo[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const routes: HostRouteInfo[] = [];

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const row = entry as IpRouteEntry;
    const destination = typeof row.dst === 'string' && row.dst.trim() ? row.dst.trim() : 'default';
    const topGateway = typeof row.gateway === 'string' && row.gateway.trim() ? row.gateway.trim() : undefined;
    const topDevice = typeof row.dev === 'string' && row.dev.trim() ? row.dev.trim() : undefined;
    const nexthops = Array.isArray(row.nexthops) ? row.nexthops : [];

    if (nexthops.length > 0) {
      for (const hop of nexthops) {
        if (!hop || typeof hop !== 'object') {
          continue;
        }

        const gateway = typeof hop.gateway === 'string' && hop.gateway.trim() ? hop.gateway.trim() : topGateway;
        const device = typeof hop.dev === 'string' && hop.dev.trim() ? hop.dev.trim() : topDevice;

        pushRoute(routes, destination, gateway, device);
      }

      continue;
    }

    pushRoute(routes, destination, topGateway, topDevice);
  }

  return routes;
}

function stripCidr(address: string): string {
  const slash = address.indexOf('/');

  return slash >= 0 ? address.slice(0, slash) : address;
}

function findIfaceOwningIp(interfaces: HostInterfaceInfo[], ip: string): HostInterfaceInfo | null {
  const needle = ip.trim().toLowerCase();

  if (!needle) {
    return null;
  }

  return (
    interfaces.find((iface) => iface.addresses.some((address) => stripCidr(address).toLowerCase() === needle)) ?? null
  );
}

function ifaceLabel(iface: HostInterfaceInfo | undefined, fallbackName: string): string {
  if (!iface) {
    return fallbackName;
  }

  const addressSummary = iface.addresses.map(stripCidr).slice(0, 2).join(', ');

  return addressSummary ? `${iface.name} (${addressSummary})` : iface.name;
}

/**
 * Merge host interfaces/routes into an existing Docker topology.
 * Links Docker exit gateways to owning host ifaces and default egress to internet.
 */
export function mergeHostNetworkingIntoTopology(input: {
  nodes: TopologyNodeInput[];
  edges: TopologyEdgeInput[];
  hostInterfaces: HostInterfaceInfo[];
  hostRoutes: HostRouteInfo[];
}): { nodes: TopologyNodeInput[]; edges: TopologyEdgeInput[] } {
  const nodes = [...input.nodes];
  const edges = [...input.edges];
  const seenNodes = new Set(nodes.map((node) => node.id));
  const seenEdges = new Set(edges.map((edge) => edge.id));
  const ensureNode = (id: string, label: string, kind: ContainerManagerTopologyNodeKind): void => {
    if (seenNodes.has(id)) {
      return;
    }

    seenNodes.add(id);
    nodes.push({ id, label, kind });
  };
  const ensureEdge = (id: string, from: string, to: string, label?: string): void => {
    if (seenEdges.has(id) || from === to) {
      return;
    }

    seenEdges.add(id);
    edges.push({ id, from, to, label });
  };
  const dockerLinkedIfaceNames = new Set<string>();

  for (const node of input.nodes) {
    if (node.kind !== 'exit') {
      continue;
    }

    const gatewayIp = node.label.trim();
    const iface = findIfaceOwningIp(input.hostInterfaces, gatewayIp);

    if (!iface) {
      continue;
    }

    const ifaceId = `host_iface:${iface.name}`;

    ensureNode(ifaceId, ifaceLabel(iface, iface.name), 'host_iface');
    ensureEdge(`exit-${gatewayIp}-on-${iface.name}`, node.id, ifaceId, `on ${iface.name}`);
    dockerLinkedIfaceNames.add(iface.name);
  }

  for (const iface of input.hostInterfaces) {
    ensureNode(`host_iface:${iface.name}`, ifaceLabel(iface, iface.name), 'host_iface');
  }

  const defaultRoutes = input.hostRoutes.filter((route) => isDefaultDestination(route.destination));
  const relevantRoutes = input.hostRoutes.filter((route) => {
    if (isDefaultDestination(route.destination)) {
      return true;
    }

    if (route.device && dockerLinkedIfaceNames.has(route.device)) {
      return true;
    }

    if (route.gateway && findIfaceOwningIp(input.hostInterfaces, route.gateway)) {
      return true;
    }

    return false;
  });

  for (const route of relevantRoutes) {
    if (!route.device) {
      continue;
    }

    const iface = input.hostInterfaces.find((item) => item.name === route.device);
    const ifaceId = `host_iface:${route.device}`;

    ensureNode(ifaceId, ifaceLabel(iface, route.device), 'host_iface');

    if (route.gateway) {
      const gwId = `host_gw:${route.gateway}`;

      ensureNode(gwId, route.gateway, 'host_gateway');
      ensureEdge(
        `host-route-${route.device}-${route.destination}-${route.gateway}`,
        ifaceId,
        gwId,
        isDefaultDestination(route.destination) ? 'default' : route.destination,
      );
    }
  }

  if (defaultRoutes.length > 0) {
    ensureNode('internet', 'Internet', 'internet');

    const uplinkIfaceNames = new Set<string>();
    const uplinkGatewayIds = new Set<string>();

    for (const route of defaultRoutes) {
      if (route.device) {
        const iface = input.hostInterfaces.find((item) => item.name === route.device);

        ensureNode(`host_iface:${route.device}`, ifaceLabel(iface, route.device), 'host_iface');
        uplinkIfaceNames.add(route.device);
      }

      if (route.gateway) {
        const gwId = `host_gw:${route.gateway}`;

        ensureNode(gwId, route.gateway, 'host_gateway');
        ensureEdge(`host-gw-${route.gateway}-internet`, gwId, 'internet', 'default');
        uplinkGatewayIds.add(gwId);

        if (route.device) {
          ensureEdge(
            `host-route-${route.device}-default-${route.gateway}`,
            `host_iface:${route.device}`,
            gwId,
            'default',
          );
        }
      } else if (route.device) {
        ensureEdge(`host-iface-${route.device}-internet`, `host_iface:${route.device}`, 'internet', 'default');
      }
    }

    // Docker bridges only own the container subnet; egress is via the host uplink (NAT/forward).
    for (const dockerIfaceName of dockerLinkedIfaceNames) {
      const dockerIfaceId = `host_iface:${dockerIfaceName}`;

      for (const uplinkName of uplinkIfaceNames) {
        if (uplinkName === dockerIfaceName) {
          continue;
        }

        ensureEdge(`host-forward-${dockerIfaceName}-${uplinkName}`, dockerIfaceId, `host_iface:${uplinkName}`, 'nat');
      }

      // If default has a gateway but no distinct uplink iface, jump bridge → gateway.
      if (uplinkIfaceNames.size === 0) {
        for (const gwId of uplinkGatewayIds) {
          ensureEdge(`host-forward-${dockerIfaceName}-${gwId}`, dockerIfaceId, gwId, 'nat');
        }
      }

      // Device-only default (no gateway): bridge → internet via uplink already covered; if no uplink, direct.
      if (uplinkIfaceNames.size === 0 && uplinkGatewayIds.size === 0) {
        ensureEdge(`host-forward-${dockerIfaceName}-internet`, dockerIfaceId, 'internet', 'nat');
      }
    }
  }

  return { nodes, edges };
}
