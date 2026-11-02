import {
  isSensitiveVariable,
  type DiscoveredDrbdResource,
  type DiscoveredEnvVariable,
  type DiscoveredInterface,
  type DiscoveredListener,
  type DiscoveredRoute,
  type DiscoveredVpn,
} from '@forepath/loadweaver/shared/util-agent-protocol';

import { renderedNodeIds } from '../volumes/drbd.renderer';

/** Interfaces Loadweaver manages (`lw0`, `lwbr0`, `lw-vpn`, `lw-<id>`, `lwk*`). */
export const LOADWEAVER_INTERFACE = /^(lw0|lwbr0|lw-vpn|lw-[0-9a-f]{8}|lwk.*)$/;

/** Labels discovery reports: compose's and Loadweaver's own; other labels may carry secrets. */
export function reportedLabels(labels: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels ?? {})
      .filter(([k]) => k.startsWith('com.docker.compose.') || k.startsWith('loadweaver.com/'))
      .map(([k, v]) => [k.slice(0, 256), String(v).slice(0, 1024)]),
  );
}

/** `host:port` of `ss` (`0.0.0.0:80`, `[::]:22`, `127.0.0.53%lo:53`, `*:5353`) → address and port. */
function splitAddress(local: string): { address: string; port: number } | null {
  const index = local.lastIndexOf(':');

  if (index < 0) return null;

  const port = Number(local.slice(index + 1));

  if (!Number.isInteger(port) || port < 0 || port > 65535) return null;

  const address = local
    .slice(0, index)
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');

  return { address: address || '*', port };
}

/** Listening sockets from `ss -H -l -t -u -n -p` (TCP `LISTEN`, UDP `UNCONN`). */
export function parseSsListeners(output: string): DiscoveredListener[] {
  const listeners: DiscoveredListener[] = [];
  const seen = new Set<string>();

  for (const line of output.split('\n')) {
    const parts = line.trim().split(/\s+/);

    if (parts.length < 5 || (parts[0] !== 'tcp' && parts[0] !== 'udp')) continue;

    const local = splitAddress(parts[4]);

    if (!local) continue;

    const users = /users:\(\("([^"]{1,128})",pid=(\d+)/.exec(line);
    const key = `${parts[0]}|${local.address}|${local.port}`;

    if (seen.has(key)) continue;

    seen.add(key);
    listeners.push({
      protocol: parts[0],
      address: local.address,
      port: local.port,
      ...(users ? { process: users[1], pid: Number(users[2]) } : {}),
    });
  }

  return listeners.sort(
    (a, b) => a.protocol.localeCompare(b.protocol) || a.port - b.port || a.address.localeCompare(b.address),
  );
}

interface IpLink {
  ifname?: string;
  flags?: string[];
  link_type?: string;
  linkinfo?: { info_kind?: string };
  addr_info?: { family?: string; local?: string; prefixlen?: number }[];
}

/** Interfaces with kinds and addresses from `ip -j -d addr show`. */
export function parseIpAddresses(json: unknown): DiscoveredInterface[] {
  if (!Array.isArray(json)) return [];

  return (json as IpLink[])
    .filter((l) => typeof l.ifname === 'string')
    .map((l) => ({
      name: (l.ifname as string).slice(0, 32),
      kind: (
        l.linkinfo?.info_kind ?? (l.link_type === 'loopback' ? 'loopback' : l.link_type === 'none' ? 'tun' : 'device')
      ).slice(0, 32),
      up: (l.flags ?? []).includes('UP'),
      addresses: (l.addr_info ?? [])
        .filter((a) => typeof a.local === 'string')
        .map((a) => `${a.local}/${a.prefixlen ?? (a.family === 'inet6' ? 128 : 32)}`),
    }));
}

interface IpRoute {
  dst?: string;
  gateway?: string;
  dev?: string;
  table?: string;
  type?: string;
}

/** Routes of every table from `ip -j -4|-6 route show table all`; local / broadcast routes count as table `local`. */
export function parseIpRoutes(json: unknown, family: 'inet' | 'inet6'): DiscoveredRoute[] {
  if (!Array.isArray(json)) return [];

  return (json as IpRoute[])
    .filter((r) => typeof r.dst === 'string')
    .map((r) => {
      const local = r.type === 'local' || r.type === 'broadcast' || r.type === 'multicast' || r.type === 'anycast';

      return {
        destination: (r.dst as string).slice(0, 64),
        ...(r.dev ? { device: r.dev.slice(0, 32) } : {}),
        ...(r.gateway ? { gateway: r.gateway.slice(0, 64) } : {}),
        ...(local ? { table: 'local' } : r.table ? { table: String(r.table).slice(0, 32) } : {}),
        family,
      };
    });
}

/** Tables from `nft -j list tables`. */
export function parseNftTables(json: unknown): { family: string; name: string }[] {
  const entries = (json as { nftables?: { table?: { family?: string; name?: string } }[] } | null)?.nftables ?? [];

  return entries
    .map((e) => e.table)
    .filter((t): t is { family: string; name: string } => typeof t?.family === 'string' && typeof t?.name === 'string')
    .map((t) => ({ family: t.family.slice(0, 16), name: t.name.slice(0, 64) }));
}

/** `wg show all listen-port` → interface → port. */
export function parseWgListenPorts(output: string): Map<string, number> {
  const ports = new Map<string, number>();

  for (const line of output.split('\n')) {
    const [name, port] = line.trim().split(/\s+/);

    if (name && /^\d{1,5}$/.test(port ?? '')) ports.set(name, Number(port));
  }

  return ports;
}

/** Tunnels / VPNs on the host (3.21): kept as bootstrap path, then ignored. Loadweaver's own links are not listed. */
export function detectVpns(interfaces: DiscoveredInterface[], wgPorts: Map<string, number>): DiscoveredVpn[] {
  const vpns: DiscoveredVpn[] = [];

  for (const iface of interfaces) {
    if (LOADWEAVER_INTERFACE.test(iface.name)) continue;

    let kind: DiscoveredVpn['kind'] | null = null;

    if (/^tailscale/.test(iface.name)) kind = 'tailscale';
    else if (/^zt/.test(iface.name)) kind = 'zerotier';
    else if (iface.kind === 'wireguard') kind = 'wireguard';
    else if (iface.kind === 'xfrm' || iface.kind === 'vti' || iface.kind === 'vti6' || /^ipsec/.test(iface.name))
      kind = 'ipsec';
    else if (iface.kind === 'tun' || /^(tun|tap)\d/.test(iface.name)) kind = 'openvpn';

    if (!kind) continue;

    const port = wgPorts.get(iface.name);

    vpns.push({ interface: iface.name, kind, ...(port ? { listenPort: port } : {}) });
  }

  return vpns;
}

function unquote(value: string): string {
  const trimmed = value.trim();

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    return trimmed.slice(1, -1);

  return trimmed.replace(/\s+#.*$/, '');
}

/**
 * Variables of a compose `.env` file. Values of sensitive names and values with URL credentials stay on the host
 * (`sensitive: true`, no value): the wizard asks for them.
 */
export function parseEnvFile(content: string): DiscoveredEnvVariable[] {
  const variables = new Map<string, DiscoveredEnvVariable>();

  for (const raw of content.split('\n')) {
    const line = raw.trim();

    if (!line || line.startsWith('#')) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);

    if (!match) continue;

    const value = unquote(match[2]);
    const sensitive = isSensitiveVariable(match[1], value);

    variables.set(match[1], { name: match[1], sensitive, ...(sensitive ? {} : { value: value.slice(0, 4096) }) });
  }

  return [...variables.values()].slice(0, 512);
}

/** A Loadweaver DRBD resource file (`/etc/drbd.d/lw-<minor>.res`): minor, port and the hosts' node ids. */
export function parseDrbdResource(file: string, conf: string): Omit<DiscoveredDrbdResource, 'backingDevice'> | null {
  const name = /^(lw-\d{1,6})\.res$/.exec(file)?.[1];

  if (!name || !conf.includes('Managed by Loadweaver')) return null;

  const minor = Number(/device minor (\d+);/.exec(conf)?.[1] ?? name.slice(3));
  const port = /address ipv[46] .*:(\d{1,5});/.exec(conf)?.[1];

  return {
    name,
    minor,
    ...(port ? { port: Number(port) } : {}),
    hosts: [...renderedNodeIds(conf).entries()].map(([nodeId, host]) => ({ host: host.slice(0, 64), nodeId })),
  };
}

/** `drbdsetup status --json` → resource → role and local disk state. */
export function parseDrbdStatus(json: unknown): Map<string, { role?: string; diskState?: string }> {
  const result = new Map<string, { role?: string; diskState?: string }>();

  if (!Array.isArray(json)) return result;

  for (const r of json as { name?: string; role?: string; devices?: { 'disk-state'?: string }[] }[]) {
    if (typeof r.name !== 'string') continue;

    result.set(r.name, {
      ...(r.role ? { role: String(r.role).slice(0, 32) } : {}),
      ...(r.devices?.[0]?.['disk-state'] ? { diskState: String(r.devices[0]['disk-state']).slice(0, 32) } : {}),
    });
  }

  return result;
}

/** `lvs --reportformat json -o lv_name,lv_size --units b` → LV name → bytes. */
export function parseLvs(json: unknown): Map<string, number> {
  const result = new Map<string, number>();
  const lvs = (json as { report?: { lv?: { lv_name?: string; lv_size?: string }[] }[] } | null)?.report?.[0]?.lv ?? [];

  for (const lv of lvs)
    if (lv.lv_name) result.set(lv.lv_name, Number(String(lv.lv_size ?? '0').replace(/[^0-9]/g, '')) || 0);

  return result;
}
