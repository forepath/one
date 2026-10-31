import { Injectable, Logger } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { POD_BRIDGE } from './pod-network.manager';

/** Routed veths of replicas that kept their address in a live migration (3.10, `kept-address.plugin.ts`). */
const KEPT_VETHS = 'lwk+';
const COMMENT = ['-m', 'comment', '--comment', 'loadweaver: policies in table inet loadweaver'];
const RULES: readonly (readonly string[])[] = [
  ['-i', POD_BRIDGE, '-j', 'ACCEPT', ...COMMENT],
  ['-o', POD_BRIDGE, '-j', 'ACCEPT', ...COMMENT],
  ['-i', KEPT_VETHS, '-j', 'ACCEPT', ...COMMENT],
  ['-o', KEPT_VETHS, '-j', 'ACCEPT', ...COMMENT],
];

/**
 * Docker's own firewall drops forwarded traffic it didn't set up, and with routed pod networks that includes the
 * pod traffic Loadweaver's policies allow. A packet must pass every base chain, so the pod bridge is accepted in
 * Docker's `DOCKER-USER` chain and filtered only by the Loadweaver table (default deny, 3.3).
 */
@Injectable()
export class DockerForwardManager {
  private readonly logger = new Logger(DockerForwardManager.name);

  constructor(private readonly commands: CommandRunner) {}

  async apply(): Promise<boolean> {
    let changed = false;

    for (const tool of ['iptables', 'ip6tables']) {
      try {
        await this.commands.run(tool, ['-w', '-t', 'filter', '-n', '-L', 'DOCKER-USER']);
      } catch {
        // No Docker iptables chain (other firewall backend, or the family is off): nothing to open.
        continue;
      }

      for (const rule of RULES) {
        try {
          await this.commands.run(tool, ['-w', '-t', 'filter', '-C', 'DOCKER-USER', ...rule]);
        } catch {
          await this.commands.run(tool, ['-w', '-t', 'filter', '-I', 'DOCKER-USER', '1', ...rule]);
          this.logger.log(`${tool}: DOCKER-USER accepts ${rule[0] === '-i' ? 'from' : 'to'} ${rule[1]}`);
          changed = true;
        }
      }
    }

    return changed;
  }
}
