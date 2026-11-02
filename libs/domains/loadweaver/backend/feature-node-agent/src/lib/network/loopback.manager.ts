import { Injectable } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';

export const LOOPBACK_INTERFACE = 'lw0';

interface IpAddrInfo {
  addr_info?: { local: string; prefixlen: number }[];
}

function hostPrefix(address: string): string {
  return address.includes('/') ? address : `${address}/${address.includes(':') ? 128 : 32}`;
}

/**
 * Holds the node's overlay addresses on a dummy interface (router-loopback style), so control-plane services
 * can bind to them independent of which WireGuard links currently exist.
 */
@Injectable()
export class LoopbackManager {
  constructor(private readonly commands: CommandRunner) {}

  async apply(addresses: string[]): Promise<boolean> {
    let changed = false;
    let info: IpAddrInfo[] = [];

    try {
      info = await this.commands.json<IpAddrInfo[]>('ip', ['-j', 'addr', 'show', 'dev', LOOPBACK_INTERFACE]);
    } catch {
      await this.commands.run('ip', ['link', 'add', LOOPBACK_INTERFACE, 'type', 'dummy']);
      changed = true;
    }

    const present = new Set(
      (info[0]?.addr_info ?? []).map((a) => `${a.local}/${a.prefixlen}`).filter((a) => !a.startsWith('fe80:')),
    );
    const wanted = new Set(addresses.map(hostPrefix));

    for (const address of wanted) {
      if (!present.has(address)) {
        await this.commands.run('ip', ['addr', 'add', address, 'dev', LOOPBACK_INTERFACE]);
        changed = true;
      }
    }

    for (const address of present) {
      if (!wanted.has(address)) {
        await this.commands.run('ip', ['addr', 'del', address, 'dev', LOOPBACK_INTERFACE]);
        changed = true;
      }
    }

    await this.commands.run('ip', ['link', 'set', 'dev', LOOPBACK_INTERFACE, 'up']);

    return changed;
  }
}
