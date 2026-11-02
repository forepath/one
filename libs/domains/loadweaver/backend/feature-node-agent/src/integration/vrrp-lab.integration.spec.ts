import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderKeepalived } from '../lib/network/keepalived.renderer';
import { LAB_IMAGE } from './lab.global-setup';

/**
 * Failover addresses with VRRP on real kernels (3.6): keepalived runs with the configuration the agent renders, in
 * lab containers on one bridge (a shared L2 segment). The preferred holder takes the address, a backup takes over
 * when it fails, and the address stays there when the old holder returns (no flapping).
 */

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function eventually(fn: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();

  for (;;) {
    try {
      if (fn()) return;
    } catch {
      // retry
    }

    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');

    await new Promise((r) => setTimeout(r, 300));
  }
}

describe('VRRP failover addresses on real kernels (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const network = `lw-lab-vrrp-${run}`;
  const subnet = `10.${100 + (process.pid % 50)}.${Date.now() % 250}.0/24`;
  const vip = `${subnet.split('.').slice(0, 3).join('.')}.200`;
  const root = mkdtempSync(join(tmpdir(), 'lw-lab-vrrp-'));
  const nodes = [
    { name: 'n1', priority: 200 },
    { name: 'n2', priority: 100 },
  ].map((n) => ({ ...n, container: `lw-lab-vrrp-${n.name}-${run}`, dir: join(root, n.name) }));
  const exec = (container: string, args: string[]) => docker(['exec', container, ...args]);
  const holds = (container: string) =>
    exec(container, ['ip', '-4', 'addr', 'show', 'dev', 'eth0']).includes(`${vip}/32`);
  const start = (node: (typeof nodes)[number]) =>
    docker([
      'exec',
      '-d',
      node.container,
      'keepalived',
      '--dont-fork',
      '--log-console',
      '-f',
      '/lab/keepalived.conf',
      '-p',
      '/run/keepalived.pid',
      '-r',
      '/run/vrrp.pid',
    ]);

  beforeAll(() => {
    docker(['network', 'create', '--subnet', subnet, network]);

    for (const node of nodes) {
      mkdirSync(node.dir, { recursive: true });
      writeFileSync(
        join(node.dir, 'keepalived.conf'),
        renderKeepalived(node.name, [{ address: vip, dev: 'eth0', vrid: 42, priority: node.priority }]),
      );
      docker([
        'run',
        '-d',
        '--name',
        node.container,
        '--network',
        network,
        '--cap-add',
        'NET_ADMIN',
        '--cap-add',
        'NET_BROADCAST',
        '--memory',
        '64m',
        '-v',
        `${node.dir}:/lab:ro`,
        LAB_IMAGE,
      ]);
    }
  });

  afterAll(() => {
    if (process.env['LW_LAB_KEEP'] !== '1') {
      for (const node of nodes) {
        try {
          docker(['rm', '-f', node.container]);
        } catch {
          // gone
        }
      }

      try {
        docker(['network', 'rm', network]);
      } catch {
        // gone
      }
    }

    rmSync(root, { recursive: true, force: true });
  });

  it('holds the address on the preferred node, fails over, and does not take it back', async () => {
    for (const node of nodes) exec(node.container, ['keepalived', '--config-test', '-f', '/lab/keepalived.conf']);

    start(nodes[0]);
    await eventually(() => holds(nodes[0].container));
    start(nodes[1]);
    await new Promise((r) => setTimeout(r, 4_000));
    expect(holds(nodes[0].container)).toBe(true);
    expect(holds(nodes[1].container)).toBe(false);

    // The holder fails: the backup takes over within a few advertisement intervals.
    exec(nodes[0].container, ['pkill', '-9', '-x', 'keepalived']);
    exec(nodes[0].container, ['ip', 'addr', 'del', `${vip}/32`, 'dev', 'eth0']);
    await eventually(() => holds(nodes[1].container), 10_000);

    // The old holder returns: nopreempt keeps the address where it is.
    start(nodes[0]);
    await new Promise((r) => setTimeout(r, 5_000));
    expect(holds(nodes[1].container)).toBe(true);
    expect(holds(nodes[0].container)).toBe(false);
  });
});
