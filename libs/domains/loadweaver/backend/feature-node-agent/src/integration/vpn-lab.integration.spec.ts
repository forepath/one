import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Envelope } from '@forepath/loadweaver/shared/util-agent-protocol';
import { clusterNetworkSchema, policySpecSchema } from '@forepath/loadweaver/shared/util-model';
import { generateWireguardKeyPair, wireguardPublicKey } from '@forepath/loadweaver/shared/util-pki';
import { compileNetwork, type CompilerNode } from '@forepath/loadweaver/shared/util-policy-compiler';

import { CommandRunner, type CommandResult, type RunOptions } from '../lib/host/command-runner';
import { BirdManager } from '../lib/network/bird.manager';
import { LoopbackManager } from '../lib/network/loopback.manager';
import { NftablesManager } from '../lib/network/nftables.manager';
import { VpnManager } from '../lib/network/vpn.manager';
import { WireguardManager } from '../lib/network/wireguard.manager';
import { LAB_IMAGE } from './lab.global-setup';

/**
 * Remote access on real kernels (3.31): a WireGuard client connects to the gateway with the configuration the
 * compiler produced for it and reaches exactly what its policy allows (a workload on another node, directly and
 * through its service IP), nothing else; the gateway reports the session.
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

describe('remote access on real kernels (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const root = mkdtempSync(join(tmpdir(), 'lw-vpn-lab-'));
  const octet = 100 + (process.pid % 50);
  const net = {
    lab: `lw-vpn-lab-${run}`,
    pods: {
      name: `lw-vpn-pods-${run}`,
      subnet: `10.88.${octet}.0/24`,
      node: `10.88.${octet}.2`,
      web: `10.88.${octet}.10`,
      db: `10.88.${octet}.11`,
    },
  };
  const clientNetwork = `100.96.${octet}.0/24`;
  const serviceIp = '10.92.0.10';
  const nodes = ['n1', 'n2'].map((name, i) => ({
    name,
    index: i + 1,
    container: `lw-vpn-${name}-${run}`,
    dir: join(root, name),
    keys: generateWireguardKeyPair(),
  }));
  const gatewayKey = generateWireguardKeyPair();
  const clientKey = generateWireguardKeyPair();
  const client = `lw-vpn-client-${run}`;
  const workloads = { web: `lw-vpn-web-${run}`, db: `lw-vpn-db-${run}` };
  const [n1, n2] = nodes;

  beforeAll(async () => {
    docker(['network', 'create', net.lab]);
    docker(['network', 'create', '--subnet', net.pods.subnet, '--gateway', `10.88.${octet}.254`, net.pods.name]);

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

    // n2 runs the workloads; n1 is the remote access gateway.
    docker(['network', 'connect', '--ip', net.pods.node, net.pods.name, n2.container]);

    for (const node of nodes) {
      docker(['start', node.container]);
      exec(node.container, ['bird', '-c', join(node.dir, 'bird', 'bird.conf')]);
    }

    for (const [name, ip] of [
      [workloads.web, net.pods.web],
      [workloads.db, net.pods.db],
    ] as const) {
      docker([
        'run',
        '-d',
        '--name',
        name,
        '--network',
        net.pods.name,
        '--ip',
        ip,
        '--cap-add',
        'NET_ADMIN',
        '--memory',
        '64m',
        LAB_IMAGE,
      ]);
      exec(name, ['ip', 'route', 'replace', 'default', 'via', net.pods.node]);

      for (const port of ['8080', '8081'])
        docker(['exec', '-d', name, 'sh', '-c', `while true; do echo ${name} | nc -l -p ${port}; done`]);
    }

    // The client: somewhere on the internet, with nothing but its WireGuard key.
    docker([
      'run',
      '-d',
      '--name',
      client,
      '--network',
      net.lab,
      '--cap-add',
      'NET_ADMIN',
      '--memory',
      '64m',
      LAB_IMAGE,
    ]);
  }, 120_000);

  afterAll(() => {
    if (process.env['LW_LAB_KEEP'] === '1') return;

    for (const name of [...nodes.map((n) => n.container), client, workloads.web, workloads.db]) {
      try {
        docker(['rm', '-f', name]);
      } catch {
        // gone
      }
    }

    for (const network of [net.lab, net.pods.name]) {
      try {
        docker(['network', 'rm', network]);
      } catch {
        // gone
      }
    }

    rmSync(root, { recursive: true, force: true });
  });

  it('lets a client reach exactly what its policy allows, through the gateway', async () => {
    const endpoint = (container: string) =>
      docker(['inspect', '-f', `{{(index .NetworkSettings.Networks "${net.lab}").IPAddress}}`, container]);
    const compilerNodes: CompilerNode[] = nodes.map((n) => ({
      name: n.name,
      site: 'lab',
      labels: {},
      controlPlane: false,
      witness: false,
      overlayV4: `10.93.0.${n.index}`,
      podSubnetV4: n.index === 2 ? net.pods.subnet : `10.88.${octet + 1}.0/24`,
      endpointHost: endpoint(n.container),
      wireguardPublicKey: wireguardPublicKey(n.keys.privateKey),
    }));
    const workload = (service: string, address: string) => ({
      id: `p/${service}/0`,
      project: 'p',
      deployment: 'p',
      service,
      node: 'n2',
      labels: { app: service },
      addresses: [address],
    });
    const clientId = '0b8f7c38-4c55-4a52-9f3e-6a0d1fd4a001';
    const result = compileNetwork({
      network: clusterNetworkSchema.parse({
        podPoolV4: '10.88.0.0/16',
        servicePoolV4: '10.92.0.0/16',
        overlayPoolV4: '10.93.0.0/16',
      }),
      nodes: compilerNodes,
      workloads: [workload('web', net.pods.web), workload('db', net.pods.db)],
      services: [{ project: 'p', deployment: 'p', name: 'web', serviceIps: [serviceIp] }],
      nodeGroups: [],
      workloadGroups: [],
      policies: [
        {
          name: 'staff-web',
          spec: policySpecSchema.parse({
            from: [{ clients: 'staff' }],
            to: [{ selector: { matchLabels: { app: 'web' } } }],
            rules: [{ ports: [8080] }],
          }),
        },
      ],
      remoteAccess: {
        gateways: ['n1'],
        active: 'n1',
        clientNetwork,
        port: 51800,
        groups: ['staff'],
        clients: [
          {
            id: clientId,
            label: 'alice@example.test/laptop',
            publicKey: clientKey.publicKey,
            address: `100.96.${octet}.2`,
            subnets: [],
            groups: ['staff'],
            fullTunnel: false,
          },
        ],
      },
    });

    expect(result.diagnostics.filter((d) => d.level === 'error')).toEqual([]);

    const gateway = result.nodes['n1'].remoteAccess;

    if (!gateway) throw new Error('n1 is no gateway');

    // The gateway key arrives at push time.
    const gatewayConfig = (extra: Partial<typeof gateway>) => ({
      ...gateway,
      ...extra,
      privateKey: gatewayKey.privateKey,
    });
    const sent: Envelope[] = [];
    const vpn = new VpnManager(new ContainerCommandRunner(n1.container));

    vpn.attach((envelope) => sent.push(envelope));

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

      if (node === n1) {
        expect(await vpn.apply(gatewayConfig({}))).toBe(true);
      }
    }

    // The client's side, exactly as its configuration says.
    const own = result.clients[clientId];

    writeFileSync(join(root, 'client.key'), `${clientKey.privateKey}\n`, { mode: 0o600 });
    docker(['cp', join(root, 'client.key'), `${client}:/client.key`]);
    exec(client, ['ip', 'link', 'add', 'wg0', 'type', 'wireguard']);
    exec(client, [
      'wg',
      'set',
      'wg0',
      'private-key',
      '/client.key',
      'peer',
      gatewayKey.publicKey,
      'endpoint',
      `${endpoint(n1.container)}:51800`,
      'allowed-ips',
      own.routes.join(','),
      'persistent-keepalive',
      '25',
    ]);
    exec(client, ['ip', 'addr', 'add', own.address, 'dev', 'wg0']);
    exec(client, ['ip', 'link', 'set', 'wg0', 'up']);

    for (const route of own.routes) exec(client, ['ip', 'route', 'replace', route, 'dev', 'wg0']);

    expect(own.routes).toEqual([`${net.pods.web}/32`, `${serviceIp}/32`, `100.96.${octet}.1/32`]);

    // The gateway learns the way back... and the workloads' node the way to the clients.
    await eventually(() => {
      try {
        exec(n1.container, ['ping', '-c', '1', '-W', '1', '10.93.0.2']);
      } catch {
        // only for the handshake
      }

      return (
        exec(n1.container, ['ip', 'route', 'show', net.pods.subnet]).includes('lw-') &&
        exec(n2.container, ['ip', 'route', 'show', clientNetwork]).includes('lw-')
      );
    }, 60_000);

    const reach = (address: string, port: number) => {
      try {
        return exec(client, ['sh', '-c', `nc -w 3 ${address} ${port} </dev/null`]);
      } catch {
        return '';
      }
    };

    // Allowed: the web workload directly and through its service IP (DNAT on the gateway).
    expect(await eventually(() => reach(net.pods.web, 8080).includes(workloads.web), 30_000)).toBe(true);
    expect(reach(serviceIp, 8080)).toContain(workloads.web);
    // Not allowed: another port, and the db workload even when the client routes to it itself.
    expect(reach(net.pods.web, 8081)).toBe('');
    exec(client, [
      'wg',
      'set',
      'wg0',
      'peer',
      gatewayKey.publicKey,
      'allowed-ips',
      `${own.routes.join(',')},${net.pods.db}/32`,
    ]);
    exec(client, ['ip', 'route', 'replace', `${net.pods.db}/32`, 'dev', 'wg0']);
    expect(reach(net.pods.db, 8080)).toBe('');
    // The gateway's resolver address is reachable for DNS only (nothing listens in the lab, but the path is open).
    expect(exec(n1.container, ['nft', 'list', 'chain', 'inet', 'loadweaver', 'input'])).toContain('builtin:vpn-dns');

    // The session is reported with its handshake; an idempotent apply changes nothing.
    await vpn.report();
    expect(sent.at(-1)?.type).toBe('vpnSessions');
    expect(Buffer.from(sent.at(-1)?.payload ?? []).toString('utf8')).toContain(clientKey.publicKey);
    expect(await vpn.apply(gatewayConfig({}))).toBe(false);

    // Revocation: without the peer the client reaches nothing any more.
    expect(await vpn.apply(gatewayConfig({ peers: [] }))).toBe(true);
    expect(reach(net.pods.web, 8080)).toBe('');
    vpn.onModuleDestroy();
  }, 240_000);
});
