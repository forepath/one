import {
  agentMessage,
  type Envelope,
  type NodeNetworkConfig,
  type VpnSessions,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { formatCidr, mustParseCidr } from '@forepath/loadweaver/shared/util-network';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { WIREGUARD_MTU } from './wireguard.manager';

type RemoteAccess = NonNullable<NodeNetworkConfig['remoteAccess']>;

/** The remote access gateway's WireGuard interface (3.31). */
export const VPN_INTERFACE = 'lw-vpn';
/** WireGuard re-handshakes every 2 minutes while traffic flows; older handshakes mean the client is gone. */
export const VPN_SESSION_WINDOW_SECONDS = 180;
const REPORT_MS = 60_000;

/** `wg syncconf` input: the shared gateway key and every client with exactly its own addresses. */
export function renderVpnConf(config: RemoteAccess, privateKey: string): string {
  return [
    '[Interface]',
    `PrivateKey = ${privateKey}`,
    `ListenPort = ${config.listenPort}`,
    ...config.peers.flatMap((p) => [
      '',
      '[Peer]',
      `PublicKey = ${p.publicKey}`,
      `AllowedIPs = ${p.allowedIps.join(', ')}`,
    ]),
    '',
  ].join('\n');
}

export interface VpnPeerDump {
  publicKey: string;
  endpoint: string | null;
  allowedIps: string[];
  latestHandshake: number;
  rxBytes: number;
  txBytes: number;
}

/** Parses `wg show <iface> dump`: the interface line (private key, public key, port, fwmark), then one per peer. */
export function parseVpnDump(dump: string): { publicKey: string; listenPort: number; peers: VpnPeerDump[] } | null {
  const lines = dump.split('\n').filter(Boolean);
  const head = lines[0]?.split('\t');

  if (!head || head.length < 4) return null;

  return {
    publicKey: head[1],
    listenPort: Number(head[2]),
    peers: lines.slice(1).flatMap((line) => {
      const f = line.split('\t');

      return f.length >= 8
        ? [
            {
              publicKey: f[0],
              endpoint: f[2] === '(none)' ? null : f[2],
              allowedIps: f[3] === '(none)' ? [] : f[3].split(',').sort(),
              latestHandshake: Number(f[4]),
              rxBytes: Number(f[5]),
              txBytes: Number(f[6]),
            },
          ]
        : [];
    }),
  };
}

/** True when the interface's peers / port differ from the desired ones. */
export function vpnDiffers(config: RemoteAccess, current: ReturnType<typeof parseVpnDump>, publicKey: string): boolean {
  if (!current || current.listenPort !== config.listenPort || current.publicKey !== publicKey) return true;

  const wanted = new Map(config.peers.map((p) => [p.publicKey, [...p.allowedIps].sort().join(',')]));

  return (
    current.peers.length !== wanted.size ||
    current.peers.some((p) => wanted.get(p.publicKey) !== p.allowedIps.join(','))
  );
}

/** Clients with a handshake inside the session window. */
export function activeSessions(peers: readonly VpnPeerDump[], nowSeconds: number): VpnSessions['sessions'] {
  return peers
    .filter((p) => p.latestHandshake > 0 && nowSeconds - p.latestHandshake <= VPN_SESSION_WINDOW_SECONDS)
    .map((p) => ({
      publicKey: p.publicKey,
      endpoint: p.endpoint,
      latestHandshake: p.latestHandshake,
      rxBytes: p.rxBytes,
      txBytes: p.txBytes,
    }));
}

/**
 * Remote access gateway (3.31): `lw-vpn` with the shared gateway key and all valid clients (`wg syncconf`, so
 * running sessions survive peer changes, and the key only ever passes through stdin). Only the active gateway gets
 * the client-network address and the office routes; standby gateways keep the peers for a quick takeover. Active
 * sessions are reported every minute.
 */
@Injectable()
export class VpnManager implements OnModuleDestroy {
  private readonly logger = new Logger(VpnManager.name);
  private send: ((envelope: Envelope) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private active = false;

  constructor(private readonly commands: CommandRunner) {}

  attach(send: (envelope: Envelope) => void): void {
    this.send = send;
    this.timer ??= setInterval(() => void this.report(), REPORT_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async exists(): Promise<boolean> {
    const { stdout } = await this.commands.run('wg', ['show', 'interfaces']);

    return stdout.split(/\s+/).includes(VPN_INTERFACE);
  }

  async apply(config: RemoteAccess | undefined): Promise<boolean> {
    this.active = !!config?.active;

    if (!config) {
      if (!(await this.exists())) return false;

      await this.commands.run('ip', ['link', 'del', 'dev', VPN_INTERFACE]);

      return true;
    }

    // Without the key nothing can be configured; the rest of the node's state still applies.
    if (!config.privateKey) {
      this.logger.warn('Remote access gateway key missing from the desired state; lw-vpn left as it is');

      return false;
    }

    let changed = false;

    if (!(await this.exists())) {
      await this.commands.run('ip', ['link', 'add', 'dev', VPN_INTERFACE, 'type', 'wireguard']);
      changed = true;
    }

    const publicKey = (await this.commands.run('wg', ['pubkey'], { input: `${config.privateKey}\n` })).stdout.trim();
    const current = parseVpnDump((await this.commands.run('wg', ['show', VPN_INTERFACE, 'dump'])).stdout);

    if (vpnDiffers(config, current, publicKey)) {
      await this.commands.run('wg', ['syncconf', VPN_INTERFACE, '/dev/stdin'], {
        input: renderVpnConf(config, config.privateKey),
      });
      changed = true;
    }

    // Standby gateways have no address and no routes: the client prefixes stay routed to the active one.
    changed = (await this.reconcileAddress(config.active ? [config.address] : [])) || changed;
    await this.commands.run('ip', ['link', 'set', 'dev', VPN_INTERFACE, 'mtu', String(WIREGUARD_MTU), 'up']);
    changed = (await this.reconcileRoutes(config.active ? config.prefixes : [], config.address)) || changed;

    return changed;
  }

  private async reconcileAddress(wanted: string[]): Promise<boolean> {
    const info = await this.commands.json<{ addr_info?: { local: string; prefixlen: number; family: string }[] }[]>(
      'ip',
      ['-j', 'addr', 'show', 'dev', VPN_INTERFACE],
    );
    const present = (info[0]?.addr_info ?? [])
      .filter((a) => a.family === 'inet')
      .map((a) => `${a.local}/${a.prefixlen}`);
    let changed = false;

    for (const address of wanted.filter((a) => !present.includes(a))) {
      await this.commands.run('ip', ['addr', 'add', address, 'dev', VPN_INTERFACE]);
      changed = true;
    }

    for (const address of present.filter((a) => !wanted.includes(a))) {
      await this.commands.run('ip', ['addr', 'del', address, 'dev', VPN_INTERFACE]);
      changed = true;
    }

    return changed;
  }

  /** Office subnets into the tunnel; the client network itself is the address's connected route. */
  private async reconcileRoutes(prefixes: readonly string[], address: string): Promise<boolean> {
    const routes = await this.commands.json<{ dst: string; protocol?: string }[]>('ip', [
      '-j',
      '-4',
      'route',
      'show',
      'dev',
      VPN_INTERFACE,
    ]);
    const connected = new Set(routes.filter((r) => r.protocol === 'kernel').map((r) => r.dst));
    const network = formatCidr(mustParseCidr(address, false));
    const wanted = prefixes.filter((p) => !p.includes(':') && p !== network);
    const present = routes
      .filter((r) => r.protocol !== 'kernel')
      .map((r) => (r.dst.includes('/') ? r.dst : `${r.dst}/32`));
    let changed = false;

    for (const prefix of wanted.filter((p) => !present.includes(p) && !connected.has(p))) {
      await this.commands.run('ip', ['route', 'replace', prefix, 'dev', VPN_INTERFACE]);
      changed = true;
    }

    for (const prefix of present.filter((p) => !wanted.includes(p))) {
      await this.commands.run('ip', ['route', 'del', prefix, 'dev', VPN_INTERFACE]);
      changed = true;
    }

    return changed;
  }

  /** Active sessions of the active gateway, for the control plane's session list and "last seen". */
  async report(nowSeconds = Math.floor(Date.now() / 1000)): Promise<void> {
    if (!this.send || !this.active) return;

    try {
      const dump = parseVpnDump((await this.commands.run('wg', ['show', VPN_INTERFACE, 'dump'])).stdout);

      this.send(agentMessage('vpnSessions', { sessions: activeSessions(dump?.peers ?? [], nowSeconds) }));
    } catch (error) {
      this.logger.warn(`VPN session report failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
