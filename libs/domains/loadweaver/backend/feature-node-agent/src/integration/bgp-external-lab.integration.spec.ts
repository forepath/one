import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExternalBgp } from '@forepath/loadweaver/shared/util-agent-protocol';

import { renderExternalBgp } from '../lib/network/bird-external.renderer';
import { LAB_IMAGE } from './lab.global-setup';

/**
 * External BGP on real BIRD (3.27): an edge node with the agent's rendered eBGP configuration peers with an
 * "upstream" router. Imports are filtered (default route only, no bogons), the announcement carries its prepends
 * and communities, graceful shutdown adds the RFC 8326 community.
 */

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function eventually(fn: () => boolean, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();

  for (;;) {
    try {
      if (fn()) return;
    } catch {
      // retry
    }

    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');

    await new Promise((r) => setTimeout(r, 500));
  }
}

describe('external BGP on real BIRD (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const network = `lw-lab-bgp-${run}`;
  const subnet = `10.${120 + (process.pid % 30)}.${Date.now() % 250}.0/24`;
  const prefix = subnet.split('.').slice(0, 3).join('.');
  const edge = { container: `lw-lab-edge-${run}`, ip: `${prefix}.10` };
  const upstream = { container: `lw-lab-upstream-${run}`, ip: `${prefix}.20` };
  const root = mkdtempSync(join(tmpdir(), 'lw-lab-bgp-'));
  const birdc = (c: string, ...args: string[]) => docker(['exec', c, 'birdc', '-s', '/run/bird/bird.ctl', ...args]);
  /** `birdc show route` exits non-zero when nothing matches. */
  const route = (c: string, ...args: string[]) => {
    try {
      return birdc(c, 'show', 'route', ...args);
    } catch {
      return '';
    }
  };
  const external = (gracefulShutdown: boolean): ExternalBgp => ({
    asn: 4_200_000_001,
    peers: [{ name: 'upstream', address: upstream.ip, asn: 64500, bfd: false, import: 'default', maxPrefixes: 10 }],
    announcements: [{ prefix: '203.0.113.0/24', peers: ['upstream'], communities: ['64500:100'], prepend: 2 }],
    rtrServers: [],
    gracefulShutdown,
  });
  const edgeConfig = (ext: ExternalBgp) =>
    [`router id ${edge.ip};`, 'protocol device { scan time 10; }', renderExternalBgp(ext)].join('\n');

  beforeAll(() => {
    docker(['network', 'create', '--subnet', subnet, network]);

    for (const [node, config] of [
      [edge, edgeConfig(external(false))],
      [
        upstream,
        [
          `router id ${upstream.ip};`,
          'protocol device { scan time 10; }',
          // A default route, a bogon and an ordinary prefix.
          'protocol static up_routes { ipv4; route 0.0.0.0/0 blackhole; route 10.99.0.0/16 blackhole; route 8.8.8.0/24 blackhole; }',
          `protocol bgp edge { local as 64500; neighbor ${edge.ip} as 4200000001; ipv4 { import all; export all; }; }`,
        ].join('\n'),
      ],
    ] as const) {
      const dir = join(root, node.container);

      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'bird.conf'), `${config}\n`);
      docker([
        'run',
        '-d',
        '--name',
        node.container,
        '--network',
        network,
        '--ip',
        node.ip,
        '--cap-add',
        'NET_ADMIN',
        '--memory',
        '64m',
        '-v',
        `${dir}:/lab`,
        LAB_IMAGE,
      ]);
      docker(['exec', node.container, 'bird', '-p', '-c', '/lab/bird.conf']);
      docker(['exec', node.container, 'bird', '-c', '/lab/bird.conf', '-s', '/run/bird/bird.ctl']);
    }
  });

  afterAll(() => {
    if (process.env['LW_LAB_KEEP'] !== '1') {
      for (const name of [edge.container, upstream.container]) {
        try {
          docker(['rm', '-f', name]);
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

  it('peers, filters imports, announces with attributes and signals graceful shutdown', async () => {
    await eventually(() => birdc(edge.container, 'show', 'protocols', 'lw_ext_upstream').includes('Established'));

    // Only the default route comes in.
    await eventually(() => birdc(edge.container, 'show', 'route', '0.0.0.0/0').includes('0.0.0.0/0'));
    expect(route(edge.container, '10.99.0.0/16')).not.toContain('10.99.0.0/16');
    expect(route(edge.container, '8.8.8.0/24')).not.toContain('8.8.8.0/24');

    // The announcement, prepended twice, with its community.
    await eventually(() => birdc(upstream.container, 'show', 'route', '203.0.113.0/24').includes('203.0.113.0/24'));

    const announced = birdc(upstream.container, 'show', 'route', '203.0.113.0/24', 'all');

    expect(announced).toMatch(/BGP\.as_path: 4200000001 4200000001 4200000001/);
    expect(announced).toContain('(64500,100)');
    expect(announced).not.toContain('(65535,0)');

    // Draining: the same announcement now carries GRACEFUL_SHUTDOWN.
    writeFileSync(join(root, edge.container, 'bird.conf'), `${edgeConfig(external(true))}\n`);
    birdc(edge.container, 'configure', '"/lab/bird.conf"');
    await eventually(() => birdc(upstream.container, 'show', 'route', '203.0.113.0/24', 'all').includes('(65535,0)'));
  });
});
