import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clusterNetworkSchema, policySpecSchema } from '@forepath/loadweaver/shared/util-model';
import { compileNetwork, type CompilerNode } from '@forepath/loadweaver/shared/util-policy-compiler';

import { CommandRunner, type CommandResult, type RunOptions } from '../lib/host/command-runner';
import { generateWireguardKeyPair, wireguardPublicKey } from '@forepath/loadweaver/shared/util-pki';
import { BirdManager } from '../lib/network/bird.manager';
import { EgressRoutingManager } from '../lib/network/egress-routing.manager';
import { LoopbackManager } from '../lib/network/loopback.manager';
import { NftablesManager } from '../lib/network/nftables.manager';
import { WireguardManager } from '../lib/network/wireguard.manager';
import { LAB_IMAGE } from './lab.global-setup';

/**
 * Egress from own prefixes on real kernels (3.27): a workload on a node without the egress address reaches a server
 * "on the internet" through the gateway node over WireGuard and arrives there with the egress address; its traffic
 * inside the cluster keeps the normal routes.
 */

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

async function eventually(fn: () => boolean, timeoutMs = 30_000): Promise<boolean> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) {
    try {
      if (fn()) return true;
    } catch {
      // retry
    }
  }

  return fn();
}

describe('egress from own prefixes on real kernels (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const root = mkdtempSync(join(tmpdir(), 'lw-egress-lab-'));
  const octet = 100 + (process.pid % 50);
  const net = {
    lab: `lw-egress-lab-${run}`,
    pods: {
      name: `lw-egress-pods-${run}`,
      subnet: `10.88.${octet}.0/24`,
      node: `10.88.${octet}.2`,
      workload: `10.88.${octet}.10`,
    },
    upstream: {
      name: `lw-egress-up-${run}`,
      subnet: `198.19.${octet}.0/24`,
      gateway: `198.19.${octet}.2`,
      server: `198.19.${octet}.80`,
    },
  };
  const egressAddress = '198.18.0.50';
  const nodes = ['n1', 'n2'].map((name, i) => ({
    name,
    index: i + 1,
    container: `lw-egress-${name}-${run}`,
    dir: join(root, name),
    keys: generateWireguardKeyPair(),
  }));
  const workload = `lw-egress-ws-${run}`;
  const server = `lw-egress-srv-${run}`;
  const [n1, n2] = nodes;

  beforeAll(async () => {
    docker(['network', 'create', net.lab]);
    docker(['network', 'create', '--subnet', net.pods.subnet, net.pods.name]);
    docker(['network', 'create', '--subnet', net.upstream.subnet, net.upstream.name]);

    for (const node of nodes) {
      mkdirSync(join(node.dir, 'bird'), { recursive: true });
      writeFileSync(join(node.dir, 'wireguard.key'), `${node.keys.privateKey}\n`, { mode: 0o600 });
      writeFileSync(join(node.dir, 'bird', 'bird.conf'), `router id 10.93.0.${node.index};\nprotocol device {}\n`);
      docker([
        'create',
        '--name',
        node.container,
        '--network',
        net.lab,
        '--cap-add',
        'NET_ADMIN',
        '--sysctl',
        'net.ipv4.ip_forward=1',
        '--sysctl',
        'net.ipv4.conf.all.rp_filter=0',
        '--memory',
        '128m',
        '-v',
        `${node.dir}:${node.dir}`,
        LAB_IMAGE,
      ]);
    }

    // n1 routes its "pod network"; n2 has the uplink towards the internet.
    docker(['network', 'connect', '--ip', net.pods.node, net.pods.name, n1.container]);
    docker(['network', 'connect', '--ip', net.upstream.gateway, net.upstream.name, n2.container]);

    for (const node of nodes) {
      docker(['start', node.container]);
      exec(node.container, ['bird', '-c', join(node.dir, 'bird', 'bird.conf')]);
    }

    // The workload behind n1, and a server on the internet that sees the egress address announced by n2.
    for (const [name, network, ip, via] of [
      [workload, net.pods.name, net.pods.workload, net.pods.node],
      [server, net.upstream.name, net.upstream.server, undefined],
    ] as const) {
      docker([
        'run',
        '-d',
        '--name',
        name,
        '--network',
        network,
        '--ip',
        ip,
        '--cap-add',
        'NET_ADMIN',
        '--memory',
        '64m',
        LAB_IMAGE,
      ]);

      if (via) exec(name, ['ip', 'route', 'replace', 'default', 'via', via]);
    }

    exec(server, ['ip', 'route', 'add', `${egressAddress}/32`, 'via', net.upstream.gateway]);
    docker(['exec', '-d', server, 'sh', '-c', 'nc -lk -p 8443 >/dev/null']);
  }, 120_000);

  afterAll(() => {
    if (process.env['LW_LAB_KEEP'] === '1') return;

    for (const name of [...nodes.map((n) => n.container), workload, server]) {
      try {
        docker(['rm', '-f', name]);
      } catch {
        // gone
      }
    }

    for (const network of [net.lab, net.pods.name, net.upstream.name]) {
      try {
        docker(['network', 'rm', network]);
      } catch {
        // gone
      }
    }

    rmSync(root, { recursive: true, force: true });
  });

  it('leaves through the gateway with the egress address, compiled and applied by the real managers', async () => {
    const compilerNodes: CompilerNode[] = nodes.map((n) => ({
      name: n.name,
      site: 'lab',
      labels: {},
      controlPlane: false,
      witness: false,
      overlayV4: `10.93.0.${n.index}`,
      podSubnetV4: n.index === 1 ? net.pods.subnet : `10.88.${octet + 1}.0/24`,
      endpointHost: docker([
        'inspect',
        '-f',
        `{{(index .NetworkSettings.Networks "${net.lab}").IPAddress}}`,
        n.container,
      ]),
      wireguardPublicKey: wireguardPublicKey(n.keys.privateKey),
    }));
    const result = compileNetwork({
      network: clusterNetworkSchema.parse({
        podPoolV4: '10.88.0.0/16',
        servicePoolV4: '10.92.0.0/16',
        overlayPoolV4: '10.93.0.0/16',
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
          addresses: [net.pods.workload],
        },
      ],
      services: [],
      nodeGroups: [],
      workloadGroups: [
        {
          project: 'p',
          name: 'web',
          spec: { selector: { matchLabels: { app: 'web' } }, intraGroup: 'allow', exposed: false },
        },
      ],
      policies: [
        {
          project: 'p',
          name: 'web-out',
          spec: policySpecSchema.parse({
            from: [{ group: 'web' }],
            to: [{ builtin: 'internet' }],
            rules: [{ ports: [8443] }],
            egress: { pools: ['egress'] },
          }),
        },
      ],
      egress: [{ policy: 'p/web-out', address: egressAddress, holder: 'n2' }],
    });

    expect(result.diagnostics.filter((d) => d.level === 'error')).toEqual([]);

    for (const node of nodes) {
      const config = result.nodes[node.name];
      const runner = new ContainerCommandRunner(node.container);

      process.env['LOADWEAVER_BIRD_CONFIG'] = join(node.dir, 'bird', 'bird.conf');
      // The gateway holds the egress address like any public address (on lw0).
      await new LoopbackManager(runner).apply([...config.addresses, ...(node.name === 'n2' ? [egressAddress] : [])]);
      await new WireguardManager(runner, { wireguardKeyPath: () => join(node.dir, 'wireguard.key') } as never).apply(
        config.wireguard,
      );
      await new BirdManager(runner).apply(config);
      await new NftablesManager(runner).apply(config);
      await new EgressRoutingManager(runner).apply(config.egress);
    }

    const link = result.nodes['n1'].wireguard[0].interface;

    // The gateway needs the route back to the workload (BGP over the link).
    await eventually(() => {
      try {
        exec(n1.container, ['ping', '-c', '1', '-W', '1', '10.93.0.2']);
      } catch {
        // only for the handshake
      }

      return exec(n2.container, ['ip', 'route', 'show', net.pods.subnet]).includes(
        result.nodes['n2'].wireguard[0].interface,
      );
    }, 60_000);
    expect(exec(n1.container, ['ip', 'rule', 'show'])).toContain(`from ${net.pods.workload} lookup 7480`);
    expect(exec(n1.container, ['ip', 'route', 'show', 'table', '7480'])).toContain(`default dev ${link}`);

    // The connection arrives at the server from the egress address.
    expect(
      await eventually(() => {
        docker(['exec', '-d', workload, 'sh', '-c', `nc -w 5 ${net.upstream.server} 8443 </dev/zero >/dev/null`]);

        return exec(server, ['ss', '-Htn', 'state', 'established', '( sport = :8443 )']).includes(`${egressAddress}:`);
      }),
    ).toBe(true);
    // Other ports aren't allowed by the policy: dropped at the gateway (and the workload's node).
    expect(() => exec(workload, ['nc', '-z', '-w', '2', net.upstream.server, '8444'])).toThrow();

    // Idempotent.
    expect(
      await new EgressRoutingManager(new ContainerCommandRunner(n1.container)).apply(result.nodes['n1'].egress),
    ).toBe(false);
  }, 180_000);
});
