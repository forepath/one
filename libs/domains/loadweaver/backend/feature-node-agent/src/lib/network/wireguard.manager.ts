import type { NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { AgentStateStore } from '../state/agent-state.store';

type Link = NodeNetworkConfig['wireguard'][number];

export const WIREGUARD_MTU = 1420;
const MANAGED_PREFIX = 'lw-';
const VPN_INTERFACE_NAME = 'lw-vpn';

export interface WireguardPeerState {
  publicKey: string;
  endpoint: string | null;
  allowedIps: string[];
  keepalive: number | null;
}

export interface WireguardInterfaceState {
  name: string;
  listenPort: number;
  peers: WireguardPeerState[];
}

/** Parses `wg show all dump` (tab separated; one interface line, then one line per peer). */
export function parseWgDump(dump: string): Map<string, WireguardInterfaceState> {
  const interfaces = new Map<string, WireguardInterfaceState>();

  for (const line of dump.split('\n')) {
    const fields = line.split('\t');

    if (fields.length === 5) {
      interfaces.set(fields[0], { name: fields[0], listenPort: Number(fields[3]), peers: [] });
    } else if (fields.length === 9) {
      const iface = interfaces.get(fields[0]);

      iface?.peers.push({
        publicKey: fields[1],
        endpoint: fields[3] === '(none)' ? null : fields[3],
        allowedIps: fields[4] === '(none)' ? [] : fields[4].split(',').sort(),
        keepalive: fields[8] === 'off' ? null : Number(fields[8]),
      });
    }
  }

  return interfaces;
}

/** Desired vs. current: true if the link needs a `wg set`. */
export function linkDiffers(link: Link, current: WireguardInterfaceState | undefined): boolean {
  if (!current || current.listenPort !== link.listenPort || current.peers.length !== 1) return true;

  const peer = current.peers[0];

  return (
    peer.publicKey !== link.peerPublicKey ||
    // A NAT'ed peer has no configured endpoint; WireGuard learns the roaming address itself.
    (link.peerEndpoint !== undefined && peer.endpoint !== link.peerEndpoint) ||
    peer.allowedIps.join(',') !== [...link.allowedIps].sort().join(',') ||
    (peer.keepalive ?? undefined) !== link.persistentKeepalive
  );
}

interface IpAddrInfo {
  ifname: string;
  addr_info?: { local: string; prefixlen: number }[];
}

/**
 * Reconciles the node's WireGuard links (3.4): one interface per peer, exactly the AllowedIPs the policies
 * require. Interfaces with the `lw-` prefix are owned by Loadweaver; any other tunnel stays untouched (3.21).
 */
@Injectable()
export class WireguardManager {
  constructor(
    private readonly commands: CommandRunner,
    private readonly state: AgentStateStore,
  ) {}

  async current(): Promise<Map<string, WireguardInterfaceState>> {
    const { stdout } = await this.commands.run('wg', ['show', 'all', 'dump']);

    // `lw-vpn` (remote access, 3.31) has its own manager.
    return new Map(
      [...parseWgDump(stdout)].filter(([name]) => name.startsWith(MANAGED_PREFIX) && name !== VPN_INTERFACE_NAME),
    );
  }

  /** Applies the links; returns true if anything changed. */
  async apply(links: Link[]): Promise<boolean> {
    const current = await this.current();
    const desired = new Map(links.map((l) => [l.interface, l]));
    let changed = false;

    for (const name of current.keys()) {
      if (!desired.has(name)) {
        await this.commands.run('ip', ['link', 'del', 'dev', name]);
        changed = true;
      }
    }

    for (const link of links) {
      const existing = current.get(link.interface);

      if (!existing) {
        await this.commands.run('ip', ['link', 'add', 'dev', link.interface, 'type', 'wireguard']);
        changed = true;
      }

      if (linkDiffers(link, existing)) {
        for (const stale of existing?.peers.filter((p) => p.publicKey !== link.peerPublicKey) ?? []) {
          await this.commands.run('wg', ['set', link.interface, 'peer', stale.publicKey, 'remove']);
        }

        const args = [
          'set',
          link.interface,
          'listen-port',
          String(link.listenPort),
          'private-key',
          this.state.wireguardKeyPath(),
          'peer',
          link.peerPublicKey,
        ];

        if (link.peerEndpoint) args.push('endpoint', link.peerEndpoint);

        args.push(
          'allowed-ips',
          link.allowedIps.join(','),
          'persistent-keepalive',
          link.persistentKeepalive ? String(link.persistentKeepalive) : 'off',
        );
        await this.commands.run('wg', args);
        changed = true;
      }

      changed = (await this.reconcileAddresses(link)) || changed;
      await this.commands.run('ip', ['link', 'set', 'dev', link.interface, 'mtu', String(WIREGUARD_MTU), 'up']);
    }

    return changed;
  }

  private async reconcileAddresses(link: Link): Promise<boolean> {
    const info = await this.commands.json<IpAddrInfo[]>('ip', ['-j', 'addr', 'show', 'dev', link.interface]);
    const present = new Set((info[0]?.addr_info ?? []).map((a) => `${a.local}/${a.prefixlen}`));
    const wanted = new Set(link.addresses);
    let changed = false;

    for (const address of wanted) {
      if (!present.has(address)) {
        await this.commands.run('ip', ['addr', 'add', address, 'dev', link.interface]);
        changed = true;
      }
    }

    for (const address of present) {
      // Kernel-assigned IPv6 link-local addresses are left alone.
      if (!wanted.has(address) && !address.startsWith('fe80:')) {
        await this.commands.run('ip', ['addr', 'del', address, 'dev', link.interface]);
        changed = true;
      }
    }

    return changed;
  }
}
