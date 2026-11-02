import { isIPv6 } from 'node:net';

import { CommandRunner } from '../host/command-runner';
import { MIGRATION_TRANSFER_MARK } from '../network/nftables.renderer';

export const MIGRATION_TABLE = 'lw_migration';

function tag(migration: string): string {
  return `migration:${migration.replace(/[^A-Za-z0-9-]/g, '')}`;
}

/**
 * The nft commands of one transfer allowance (3.10). Target: the source's overlay addresses may reach the transfer
 * port (input). Source: the agent (uid 0) may reach the target's endpoint (output). Both only mark the packets; the
 * Loadweaver table accepts the mark (`builtin:migration-transfer`).
 */
export function transferRuleArgs(
  direction: 'input' | 'output',
  peerAddress: string,
  port: number,
  migration: string,
): string[] {
  const family = isIPv6(peerAddress) ? 'ip6' : 'ip';

  return [
    'add',
    'rule',
    'inet',
    MIGRATION_TABLE,
    direction,
    family,
    direction === 'input' ? 'saddr' : 'daddr',
    peerAddress,
    'tcp',
    'dport',
    String(port),
    ...(direction === 'output' ? ['meta', 'skuid', '0'] : []),
    'meta',
    'mark',
    'set',
    MIGRATION_TRANSFER_MARK,
    'comment',
    `"${tag(migration)}"`,
  ];
}

/**
 * Temporary firewall allowance of a checkpoint transfer between exactly two nodes, for one session: its own table
 * (the Loadweaver table is replaced on every apply), removed when the session ends; leftovers of a previous agent
 * process are flushed at start.
 */
export class TransferFirewall {
  constructor(private readonly commands: CommandRunner) {}

  async allow(direction: 'input' | 'output', peerAddresses: string[], port: number, migration: string): Promise<void> {
    await this.commands.run('nft', ['add', 'table', 'inet', MIGRATION_TABLE]);
    await this.commands.run('nft', [
      'add',
      'chain',
      'inet',
      MIGRATION_TABLE,
      direction,
      `{ type filter hook ${direction} priority -10 ; policy accept ; }`,
    ]);

    for (const address of peerAddresses)
      await this.commands.run('nft', transferRuleArgs(direction, address, port, migration));
  }

  async revoke(migration: string): Promise<void> {
    for (const chain of ['input', 'output']) {
      const listing = await this.commands
        .run('nft', ['-a', 'list', 'chain', 'inet', MIGRATION_TABLE, chain])
        .then((r) => r.stdout)
        .catch(() => '');

      for (const line of listing.split('\n').filter((l) => l.includes(`"${tag(migration)}"`))) {
        const handle = /# handle (\d+)/.exec(line)?.[1];

        if (handle)
          await this.commands
            .run('nft', ['delete', 'rule', 'inet', MIGRATION_TABLE, chain, 'handle', handle])
            .catch(() => undefined);
      }
    }
  }

  async flush(): Promise<void> {
    await this.commands.run('nft', ['delete', 'table', 'inet', MIGRATION_TABLE]).catch(() => undefined);
  }
}
