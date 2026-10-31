import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clusterNetworkSchema, policySpecSchema } from '@forepath/loadweaver/shared/util-model';
import { compileNetwork, type CompilerNode } from '@forepath/loadweaver/shared/util-policy-compiler';

import { CommandRunner, type CommandResult, type RunOptions } from '../lib/host/command-runner';
import { generateWireguardKeyPair, wireguardPublicKey } from '@forepath/loadweaver/shared/util-pki';
import { BirdManager } from '../lib/network/bird.manager';
import { LoopbackManager } from '../lib/network/loopback.manager';
import { NftablesManager } from '../lib/network/nftables.manager';
import { WireguardManager } from '../lib/network/wireguard.manager';
import { LIVE_TABLE, TunnelFirewall } from '../lib/live/tunnel-firewall';
import { LAB_IMAGE } from './lab.global-setup';

/**
 * Real-kernel lab test (section 6) for the riskiest part of M1: two nodes, each in its own container network
 * namespace, configured by the real managers from real compiler output. Verifies the WireGuard handshake, the
 * iBGP session, the routes it installs and nftables allow / deny on real traffic.
 */

/** Runs host tools inside a lab container instead of the host. */
class ContainerCommandRunner extends CommandRunner {
  constructor(private readonly container: string) {
    super();
  }

  override async run(command: string, args: readonly string[], options: RunOptions = {}): Promise<CommandResult> {
    return await super.run(
      'docker',
      ['exec', ...(options.input !== undefined ? ['-i'] : []), this.container, command, ...args],
      options,
    );
  }
}

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function exec(container: string, args: string[]): string {
  return docker(['exec', container, ...args]);
}

async function eventually<T>(fn: () => T | undefined, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();

  for (;;) {
    try {
      const value = fn();

      if (value !== undefined && value !== false) return value;
    } catch {
      // retry
    }

    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');

    await new Promise((r) => setTimeout(r, 500));
  }
}

describe('node network on real kernels (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const network = `lw-lab-${run}`;
  const root = mkdtempSync(join(tmpdir(), 'lw-lab-'));
  const nodes = ['n1', 'n2'].map((name, i) => ({
    name,
    index: i + 1,
    container: `lw-lab-${name}-${run}`,
    dir: join(root, name),
    keys: generateWireguardKeyPair(),
  }));

  beforeAll(() => {
    docker(['network', 'create', network]);

    for (const node of nodes) {
      mkdirSync(join(node.dir, 'bird'), { recursive: true });
      writeFileSync(join(node.dir, 'wireguard.key'), `${node.keys.privateKey}\n`, { mode: 0o600 });
      writeFileSync(join(node.dir, 'bird', 'bird.conf'), `router id 10.93.0.${node.index};\nprotocol device {}\n`);
      docker([
        'run',
        '-d',
        '--name',
        node.container,
        '--network',
        network,
        '--cap-add',
        'NET_ADMIN',
        '--sysctl',
        'net.ipv4.ip_forward=1',
        '--sysctl',
        'net.ipv6.conf.all.disable_ipv6=0',
        '--sysctl',
        'net.ipv6.conf.all.forwarding=1',
        '--memory',
        '128m',
        '-v',
        `${node.dir}:${node.dir}`,
        LAB_IMAGE,
      ]);
      exec(node.container, ['bird', '-c', join(node.dir, 'bird', 'bird.conf')]);
    }
  });

  afterAll(() => {
    // Debugging aid: LW_LAB_KEEP=1 leaves the lab containers running for inspection.
    if (process.env['LW_LAB_KEEP'] === '1') return;

    for (const node of nodes) {
      try {
        docker(['rm', '-f', node.container]);
      } catch {
        // already gone
      }
    }

    try {
      docker(['network', 'rm', network]);
    } catch {
      // already gone
    }

    rmSync(root, { recursive: true, force: true });
  });

  it('builds the tunnel, peers via BGP, installs routes and filters exactly as compiled', async () => {
    const compilerNodes: CompilerNode[] = nodes.map((n) => ({
      name: n.name,
      site: 'lab',
      labels: { lab: 'true' },
      controlPlane: false,
      witness: false,
      overlayV4: `10.93.0.${n.index}`,
      overlayV6: `fd00:93::${n.index}`,
      podSubnetV4: `10.88.${n.index}.0/24`,
      podSubnetV6: `fd00:88:${n.index}::/80`,
      endpointHost: docker([
        'inspect',
        '-f',
        `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,
        n.container,
      ]),
      wireguardPublicKey: wireguardPublicKey(n.keys.privateKey),
    }));
    const result = compileNetwork({
      network: clusterNetworkSchema.parse({
        podPoolV4: '10.88.0.0/16',
        podPoolV6: 'fd00:88::/48',
        servicePoolV4: '10.92.0.0/16',
        overlayPoolV4: '10.93.0.0/16',
        overlayPoolV6: 'fd00:93::/112',
      }),
      nodes: compilerNodes,
      workloads: [
        {
          id: 'p/web/0',
          project: 'p',
          deployment: 'p',
          service: 'web',
          node: 'n1',
          labels: { app: 'web' },
          addresses: ['10.88.1.10', 'fd00:88:1::10'],
        },
        {
          id: 'p/api/0',
          project: 'p',
          deployment: 'p',
          service: 'api',
          node: 'n2',
          labels: { app: 'api' },
          addresses: ['10.88.2.10', 'fd00:88:2::10'],
        },
      ],
      services: [],
      nodeGroups: [{ name: 'lab', spec: { selector: { matchLabels: { lab: 'true' } }, intraGroup: 'isolate' } }],
      workloadGroups: ['web', 'api'].map((app) => ({
        project: 'p',
        name: app,
        spec: { selector: { matchLabels: { app } }, intraGroup: 'isolate' as const, exposed: false },
      })),
      policies: [
        {
          name: 'lab-9000',
          spec: policySpecSchema.parse({
            from: [{ group: 'lab' }],
            to: [{ group: 'lab' }],
            rules: [{ protocol: 'tcp', ports: [9000] }],
          }),
        },
        {
          project: 'p',
          name: 'web-to-api',
          spec: policySpecSchema.parse({
            from: [{ group: 'web' }],
            to: [{ group: 'api' }],
            rules: [{ ports: [8080] }],
          }),
        },
      ],
    });

    expect(result.diagnostics).toEqual([]);

    for (const node of nodes) {
      const config = result.nodes[node.name];
      const runner = new ContainerCommandRunner(node.container);

      process.env['LOADWEAVER_BIRD_CONFIG'] = join(node.dir, 'bird', 'bird.conf');
      await new LoopbackManager(runner).apply(config.addresses);
      await new WireguardManager(runner, { wireguardKeyPath: () => join(node.dir, 'wireguard.key') } as never).apply(
        config.wireguard,
      );
      await new BirdManager(runner).apply(config);
      await new NftablesManager(runner).apply(config);
    }

    const [n1, n2] = nodes;
    const link = result.nodes['n1'].wireguard[0].interface;

    // WireGuard handshake: any packet towards the peer's allowed IPs triggers it.
    await eventually(() => {
      try {
        exec(n1.container, ['ping', '-c', '1', '-W', '1', '10.93.0.2']);
      } catch {
        // ICMP between the nodes is not allowed by any policy; the handshake still happens.
      }

      return Number(exec(n1.container, ['wg', 'show', link, 'latest-handshakes']).split(/\s+/)[1]) > 0;
    });

    // iBGP session over the tunnel, with exactly the compiled routes.
    await eventually(() => exec(n1.container, ['birdc', 'show', 'protocols', 'lw_n2_4']).includes('Established'));
    await eventually(() => exec(n1.container, ['ip', 'route', 'show', '10.88.2.0/24']).includes(link));
    expect(exec(n1.container, ['ip', 'route', 'show', '10.93.0.2'])).toContain(link);

    // Dual-stack (3.23): a second session for IPv6 over the same tunnel, IPv6 pod subnet routed.
    await eventually(() => exec(n1.container, ['birdc', 'show', 'protocols', 'lw_n2_6']).includes('Established'));
    await eventually(() => exec(n1.container, ['ip', '-6', 'route', 'show', 'fd00:88:2::/80']).includes(link));

    // Filtering: tcp/9000 is allowed between the nodes, tcp/9001 is not (default deny on lw-* interfaces).
    for (const port of ['9000', '9001']) {
      docker(['exec', '-d', n2.container, 'sh', '-c', `nc -lk -s 10.93.0.2 -p ${port} >/dev/null`]);
    }

    await eventually(() => {
      exec(n1.container, ['nc', '-z', '-w', '2', '-s', '10.93.0.1', '10.93.0.2', '9000']);

      return true;
    });
    expect(() => exec(n1.container, ['nc', '-z', '-w', '2', '-s', '10.93.0.1', '10.93.0.2', '9001'])).toThrow();
    expect(exec(n2.container, ['nft', 'list', 'chain', 'inet', 'loadweaver', 'input'])).toMatch(/lwdeny/);
    // Egress NAT for the node's own pod subnets, loaded by the real kernel.
    expect(exec(n2.container, ['nft', 'list', 'chain', 'inet', 'loadweaver', 'egress_postrouting'])).toMatch(
      /ip saddr 10\.88\.2\.0\/24 oifname != \{ "lw-\*", "lwbr0", "lwk\*" \}.*masquerade/,
    );

    // Re-applying the same configuration changes nothing (idempotent reconcile).
    const runner = new ContainerCommandRunner(n1.container);

    process.env['LOADWEAVER_BIRD_CONFIG'] = join(n1.dir, 'bird', 'bird.conf');
    expect(
      await new WireguardManager(runner, { wireguardKeyPath: () => join(n1.dir, 'wireguard.key') } as never).apply(
        result.nodes['n1'].wireguard,
      ),
    ).toBe(false);
    expect(await new BirdManager(runner).apply(result.nodes['n1'])).toBe(false);
  });

  it('lets the agent through to one replica port while a debug tunnel is open (operator mark), and not after', async () => {
    const [n1] = nodes;
    const runner = new ContainerCommandRunner(n1.container);
    const firewall = new TunnelFirewall(runner);

    await firewall.allow('10.88.1.9', 5432, 'chan-1');
    expect(exec(n1.container, ['nft', 'list', 'chain', 'inet', LIVE_TABLE, 'output'])).toMatch(
      /ip daddr 10\.88\.1\.9 tcp dport 5432 meta skuid 0 meta mark set 0x4c570001 comment "tunnel:chan-1"/,
    );
    // The Loadweaver output chain accepts the mark before its deny.
    expect(exec(n1.container, ['nft', 'list', 'chain', 'inet', 'loadweaver', 'output'])).toContain(
      'meta mark 0x4c570001 accept comment "builtin:operator-tunnel"',
    );

    await firewall.revoke('chan-1');
    expect(exec(n1.container, ['nft', 'list', 'chain', 'inet', LIVE_TABLE, 'output'])).not.toContain('chan-1');
  });
});
