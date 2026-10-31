import type { DiscoveryReport } from '@forepath/loadweaver/shared/util-agent-protocol';
import { cidrOverlaps, formatCidr, parseCidr, parseIp, type Cidr } from '@forepath/loadweaver/shared/util-network';

import type { ConflictResolution, ImportClusterContext, ImportConflict } from './types';

/** Ports every node binds (3.4, 3.7, 3.10): a host service on them blocks the join until it moves. */
export const NODE_PORTS: readonly { protocol: 'tcp' | 'udp'; port: number; role: string }[] = [
  { protocol: 'tcp', port: 179, role: 'BIRD (iBGP between nodes)' },
  { protocol: 'tcp', port: 7460, role: 'live-migration transfers' },
  { protocol: 'tcp', port: 15001, role: 'the mesh proxy (outbound)' },
  { protocol: 'tcp', port: 15443, role: 'the mesh proxy (inbound mTLS)' },
  { protocol: 'tcp', port: 15080, role: 'the egress proxy (HTTP)' },
  { protocol: 'tcp', port: 15444, role: 'the egress proxy (TLS)' },
];

/** Ports of control-plane members (3.2): a node holding one shouldn't become a member. */
export const MEMBER_PORTS: readonly number[] = [
  2379, 2380, 3400, 3900, 3901, 3903, 3910, 3911, 3913, 5432, 5433, 6390, 6391, 7443, 8008, 8081, 9200, 9300,
];
const MEMBER_PORT_RANGES: readonly [number, number][] = [
  [5000, 5016],
  [7500, 7755],
];

/** First WireGuard listen port (`DEFAULT_PLATFORM_PORTS.wireguardBase`) and how many the compiler may use. */
export const WIREGUARD_BASE_PORT = 51820;
const WIREGUARD_SPAN = 1024;

/** Ingress ports (3.6): a host service on them keeps the node from holding ingress addresses. */
const INGRESS_PORTS = [80, 443];

const MANAGED_INTERFACE = /^(lw0|lwbr0|lw-vpn|lw-[0-9a-f]{8}|lwk.*)$/;

export function isWildcard(address: string): boolean {
  return address === '*' || address === '0.0.0.0' || address === '::' || address === '[::]' || address === '';
}

/** Whether control-plane members bind the TCP port (etcd, Postgres / Patroni, Garage, Valkey, API, Kopia...). */
export function isMemberPort(port: number): boolean {
  return MEMBER_PORTS.includes(port) || MEMBER_PORT_RANGES.some(([from, to]) => port >= from && port <= to);
}

function ownerOf(listener: { process?: string; pid?: number }): string {
  return listener.process ? `${listener.process}${listener.pid ? ` (pid ${listener.pid})` : ''}` : 'a host process';
}

function cidrOf(value: string): Cidr | null {
  const cidr = parseCidr(value, false);

  if (cidr) return cidr;

  const ip = parseIp(value);

  return ip ? parseCidr(`${value}/${ip.family === 4 ? 32 : 128}`, false) : null;
}

/** Host routes that say nothing about address use: default, link-local, multicast, the local table. */
function ignoredRoute(destination: string, table: string | undefined): boolean {
  if (destination === 'default' || table === 'local') return true;

  const cidr = cidrOf(destination);

  if (!cidr) return true;

  const text = formatCidr(cidr);

  return text.startsWith('fe80:') || text.startsWith('ff') || text.startsWith('169.254.') || cidr.prefixLength === 0;
}

/**
 * Conflicts between a discovered host and the cluster (3.21), resolved where the plan can: generated WireGuard ports
 * skip ports the host uses, ports of imported containers are freed by their stop, pre-existing tunnels are kept as
 * the bootstrap path and then ignored. Refused with a reason: host services on ports every node binds, interfaces
 * named like Loadweaver's own (unless a former installation left them), and subnets that overlap the cluster's
 * pools — the user picks another range or removes the overlap.
 */
export function resolveConflicts(
  report: DiscoveryReport,
  cluster: ImportClusterContext,
  freed: ReadonlySet<string> = new Set(),
): ConflictResolution {
  const conflicts: ImportConflict[] = [];
  const reservedTcp = new Set<number>();
  const reservedUdp = new Set<number>();
  const former = !!report.former;

  for (const listener of report.listeners) {
    const key = `${listener.protocol}/${listener.port}`;
    const isFreed = freed.has(key);

    if (!isFreed) (listener.protocol === 'tcp' ? reservedTcp : reservedUdp).add(listener.port);

    const fixed = NODE_PORTS.find((p) => p.protocol === listener.protocol && p.port === listener.port);

    if (fixed) {
      conflicts.push(
        isFreed
          ? {
              kind: 'port',
              severity: 'resolved',
              subject: key,
              reason: `${ownerOf(listener)} uses ${key}, which ${fixed.role} needs`,
              resolution: 'freed when the imported containers stop',
            }
          : {
              kind: 'port',
              severity: isWildcard(listener.address) ? 'error' : 'warning',
              subject: key,
              reason: `${ownerOf(listener)} listens on ${listener.address}:${listener.port}; ${fixed.role} needs ${key} on every node`,
              resolution: 'move the host service to another port or stop it',
            },
      );
      continue;
    }

    if (
      listener.protocol === 'udp' &&
      listener.port >= WIREGUARD_BASE_PORT &&
      listener.port < WIREGUARD_BASE_PORT + WIREGUARD_SPAN
    ) {
      if (!isFreed)
        conflicts.push({
          kind: 'port',
          severity: 'resolved',
          subject: key,
          reason: `${ownerOf(listener)} uses ${key}, a port Loadweaver's WireGuard links may use`,
          resolution: `the node's WireGuard listen ports skip ${listener.port}`,
        });
      continue;
    }

    if (listener.protocol === 'tcp' && INGRESS_PORTS.includes(listener.port) && isWildcard(listener.address)) {
      conflicts.push(
        isFreed
          ? {
              kind: 'port',
              severity: 'resolved',
              subject: key,
              reason: `${ownerOf(listener)} serves ${key}`,
              resolution: 'handed over to the Loadweaver ingress after the import',
            }
          : {
              kind: 'port',
              severity: 'warning',
              subject: key,
              reason: `${ownerOf(listener)} serves ${key}: the node can't hold ingress addresses while it does`,
              resolution: 'import the service or move it to another port',
            },
      );
      continue;
    }

    if (!isFreed && listener.protocol === 'tcp' && isMemberPort(listener.port) && isWildcard(listener.address))
      conflicts.push({
        kind: 'port',
        severity: 'warning',
        subject: key,
        reason: `${ownerOf(listener)} listens on ${key}, which control-plane members need`,
        resolution: 'the node should not become a control-plane member while the port is in use',
      });
  }

  for (const vpn of report.vpns) {
    if (MANAGED_INTERFACE.test(vpn.interface)) continue;

    conflicts.push({
      kind: 'tunnel',
      severity: 'resolved',
      subject: vpn.interface,
      reason: `pre-existing ${vpn.kind} tunnel${vpn.listenPort ? ` (port ${vpn.listenPort})` : ''}`,
      resolution:
        'usable as bootstrap path to the control plane; the agent switches to its own WireGuard tunnel make-before-break and ignores this one afterwards',
    });

    if (vpn.listenPort) reservedUdp.add(vpn.listenPort);
  }

  for (const iface of report.interfaces) {
    if (!MANAGED_INTERFACE.test(iface.name)) continue;

    conflicts.push(
      former
        ? {
            kind: 'interface',
            severity: 'resolved',
            subject: iface.name,
            reason: `left by the former Loadweaver installation`,
            resolution: 'replaced when the node is activated',
          }
        : {
            kind: 'interface',
            severity: 'error',
            subject: iface.name,
            reason: `interface ${iface.name} uses a name Loadweaver manages (lw0, lwbr0, lw-vpn, lw-<id>, lwk*)`,
            resolution: 'rename or remove the interface',
          },
    );
  }

  const pools: { name: string; cidr: Cidr }[] = [];
  const addPool = (name: string, value: string | undefined) => {
    const cidr = value ? cidrOf(value) : null;

    if (cidr) pools.push({ name, cidr });
  };

  addPool("the cluster's pod pool", cluster.network.podPoolV4);
  addPool("the cluster's pod pool", cluster.network.podPoolV6);
  addPool("the cluster's service pool", cluster.network.servicePoolV4);
  addPool("the cluster's service pool", cluster.network.servicePoolV6);
  addPool("the cluster's overlay pool", cluster.network.overlayPoolV4);
  addPool("the cluster's overlay pool", cluster.network.overlayPoolV6);
  (cluster.nodeSubnets ?? []).forEach((s) => addPool("the node's own subnet", s));

  const seen = new Set<string>();
  const check = (subject: string, value: string, device?: string) => {
    if (device && MANAGED_INTERFACE.test(device) && former) return;

    const cidr = cidrOf(value);

    if (!cidr) return;

    for (const pool of pools) {
      if (pool.cidr.family !== cidr.family || !cidrOverlaps(pool.cidr, cidr)) continue;

      const id = `${subject}|${formatCidr(pool.cidr)}`;

      if (seen.has(id)) continue;

      seen.add(id);
      conflicts.push({
        kind: 'subnet',
        severity: 'error',
        subject,
        reason: `${subject} overlaps ${pool.name} ${formatCidr(pool.cidr)}`,
        resolution: 'pick another range for the cluster (or this node) or remove the overlap from the host',
      });
    }
  };

  for (const route of report.routes) {
    if (ignoredRoute(route.destination, route.table)) continue;

    check(`route ${route.destination}${route.device ? ` dev ${route.device}` : ''}`, route.destination, route.device);
  }

  for (const iface of report.interfaces) {
    if (iface.kind === 'loopback') continue;

    for (const address of iface.addresses) {
      if (address.startsWith('fe80:') || address.startsWith('169.254.')) continue;

      check(`address ${address} on ${iface.name}`, address, iface.name);
    }
  }

  return {
    conflicts,
    reservedPorts: { tcp: [...reservedTcp].sort((a, b) => a - b), udp: [...reservedUdp].sort((a, b) => a - b) },
  };
}
