import { readFile, rename, writeFile } from 'node:fs/promises';

import type { PublicAddress } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { AgentStateStore } from '../state/agent-state.store';
import { renderKeepalived, vrrpInstances } from './keepalived.renderer';

export function keepalivedConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_KEEPALIVED_CONFIG'] || '/etc/keepalived/keepalived.conf';
}

/** How keepalived picks up a new configuration (systemd on nodes; overridable for the lab). */
export function keepalivedReloadCommand(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env['LOADWEAVER_KEEPALIVED_RELOAD'] || 'systemctl reload-or-restart keepalived').split(' ').filter(Boolean);
}

/** BGP-announced addresses live on the loopback interface with the node's own addresses (3.27). */
export function loopbackPublicAddresses(addresses: readonly PublicAddress[] = []): string[] {
  return addresses.filter((a) => a.mode === 'bgp').map((a) => `${a.address}/${a.address.includes(':') ? 128 : 32}`);
}

/**
 * Public addresses on the node (3.6): VRRP through keepalived, provider and static addresses bound to the uplink
 * while this node is their holder. BGP addresses are bound with the loopback layer.
 */
@Injectable()
export class PublicAddressManager {
  constructor(
    private readonly commands: CommandRunner,
    private readonly state: AgentStateStore,
  ) {}

  private async defaultUplink(v6: boolean): Promise<string> {
    const routes = await this.commands.json<{ dev?: string }[]>('ip', [
      ...(v6 ? ['-6'] : []),
      '-j',
      'route',
      'show',
      'default',
    ]);
    const dev = routes.find((r) => r.dev)?.dev;

    if (!dev) throw new Error(`no default ${v6 ? 'IPv6' : 'IPv4'} route to find the uplink`);

    return dev;
  }

  async apply(nodeName: string, addresses: readonly PublicAddress[] = []): Promise<boolean> {
    const uplinks = new Map<boolean, string>();
    const uplink = async (a: PublicAddress) => {
      if (a.interface) return a.interface;

      const v6 = a.address.includes(':');

      if (!uplinks.has(v6)) uplinks.set(v6, await this.defaultUplink(v6));

      return uplinks.get(v6) as string;
    };
    const devs = new Map<string, string>();

    for (const a of addresses.filter(
      (x) => x.mode === 'vrrp' || ((x.mode === 'provider' || x.mode === 'none') && x.active),
    ))
      devs.set(a.address, await uplink(a));

    const keepalived = await this.applyKeepalived(
      nodeName,
      renderKeepalived(
        nodeName,
        vrrpInstances(addresses, (a) => devs.get(a.address) as string),
      ),
    );
    const bound = await this.applyStatic(
      addresses
        .filter((a) => (a.mode === 'provider' || a.mode === 'none') && a.active)
        .map((a) => ({
          address: `${a.address}/${a.address.includes(':') ? 128 : 32}`,
          dev: devs.get(a.address) as string,
        })),
    );

    return keepalived || bound;
  }

  private async applyKeepalived(nodeName: string, rendered: string): Promise<boolean> {
    const path = keepalivedConfigPath();
    const current = await readFile(path, 'utf8').catch(() => null);

    // Nodes without VRRP addresses don't need keepalived configured at all.
    if (current === rendered || (current === null && !rendered.includes('vrrp_instance'))) return false;

    const candidate = `${path}.loadweaver-new`;

    await writeFile(candidate, rendered, { mode: 0o640 });
    await this.commands.run('keepalived', ['--config-test', '-f', candidate]);
    await rename(candidate, path);

    const [command, ...args] = keepalivedReloadCommand();

    await this.commands.run(command, args);

    return true;
  }

  private async applyStatic(wanted: { address: string; dev: string }[]): Promise<boolean> {
    const previous = await this.state.boundPublicAddresses();
    const key = (b: { address: string; dev: string }) => `${b.address} ${b.dev}`;
    const wantedKeys = new Set(wanted.map(key));
    let changed = false;

    for (const b of previous.filter((p) => !wantedKeys.has(key(p)))) {
      await this.commands.run('ip', ['addr', 'del', b.address, 'dev', b.dev]).catch(() => undefined);
      changed = true;
    }

    for (const b of wanted) {
      // `replace` is idempotent: no error when the address is already there.
      await this.commands.run('ip', ['addr', 'replace', b.address, 'dev', b.dev]);
      changed = changed || !previous.some((p) => key(p) === key(b));
    }

    await this.state.saveBoundPublicAddresses(wanted);

    return changed;
  }
}
