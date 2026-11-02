import { createHash } from 'node:crypto';

import type { NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { renderNftables } from './nftables.renderer';

/**
 * Applies the rendered nftables script atomically (`nft -f -` is one transaction): either the whole new
 * rule set is active or the old one stays. A dry run (`nft -c`) validates the script first.
 */
@Injectable()
export class NftablesManager {
  private appliedHash: string | null = null;

  constructor(private readonly commands: CommandRunner) {}

  async apply(config: NodeNetworkConfig): Promise<boolean> {
    const script = renderNftables(config);
    const hash = createHash('sha256').update(script).digest('hex');

    if (hash === this.appliedHash) return false;

    await this.commands.run('nft', ['-c', '-f', '-'], { input: script });
    await this.commands.run('nft', ['-f', '-'], { input: script });
    this.appliedHash = hash;

    return true;
  }

  /** Removes the Loadweaver table (node leaving the cluster). */
  async remove(): Promise<void> {
    await this.commands.run('nft', ['-f', '-'], { input: 'table inet loadweaver\ndelete table inet loadweaver\n' });
    this.appliedHash = null;
  }
}
