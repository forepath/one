import { isIPv6 } from 'node:net';

import { CommandRunner } from '../host/command-runner';
import { OPERATOR_TUNNEL_MARK } from '../network/nftables.renderer';

export const LIVE_TABLE = 'lw_live';

/** The nft commands that let this node's agent reach one replica port while a tunnel is open (3.19). */
export function tunnelRuleArgs(address: string, port: number, channel: string): string[] {
  return [
    'add',
    'rule',
    'inet',
    LIVE_TABLE,
    'output',
    isIPv6(address) ? 'ip6' : 'ip',
    'daddr',
    address,
    'tcp',
    'dport',
    String(port),
    'meta',
    'skuid',
    '0',
    'meta',
    'mark',
    'set',
    OPERATOR_TUNNEL_MARK,
    'comment',
    `"tunnel:${channel.replace(/[^A-Za-z0-9-]/g, '')}"`,
  ];
}

/**
 * The temporary operator allowance of a debug tunnel: a rule in its own table (the Loadweaver table is replaced on
 * every apply) that marks the agent's packets to exactly the tunnel's replica and port; the Loadweaver output chain
 * accepts the mark. Removed when the tunnel ends.
 */
export class TunnelFirewall {
  constructor(private readonly commands: CommandRunner) {}

  async allow(address: string, port: number, channel: string): Promise<void> {
    await this.commands.run('nft', ['add', 'table', 'inet', LIVE_TABLE]);
    await this.commands.run('nft', [
      'add',
      'chain',
      'inet',
      LIVE_TABLE,
      'output',
      '{ type filter hook output priority -10 ; policy accept ; }',
    ]);
    await this.commands.run('nft', tunnelRuleArgs(address, port, channel));
  }

  /** Removes every allowance (leftovers of a previous agent process); the table is re-created by the next tunnel. */
  async flush(): Promise<void> {
    await this.commands.run('nft', ['delete', 'table', 'inet', LIVE_TABLE]).catch(() => undefined);
  }

  async revoke(channel: string): Promise<void> {
    const listing = await this.commands
      .run('nft', ['-a', 'list', 'chain', 'inet', LIVE_TABLE, 'output'])
      .then((r) => r.stdout)
      .catch(() => '');
    const tag = `tunnel:${channel.replace(/[^A-Za-z0-9-]/g, '')}`;

    for (const line of listing.split('\n').filter((l) => l.includes(`"${tag}"`))) {
      const handle = /# handle (\d+)/.exec(line)?.[1];

      if (handle)
        await this.commands
          .run('nft', ['delete', 'rule', 'inet', LIVE_TABLE, 'output', 'handle', handle])
          .catch(() => undefined);
    }
  }
}
