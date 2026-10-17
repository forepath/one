import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clusterNetworkSchema, policySpecSchema } from '@forepath/loadweaver/shared/util-model';
import {
  createCertificateAuthority,
  createCsr,
  generateKeyPair,
  issueCertificate,
  generateWireguardKeyPair,
  wireguardPublicKey,
} from '@forepath/loadweaver/shared/util-pki';
import { compileNetwork, type CompilerNode } from '@forepath/loadweaver/shared/util-policy-compiler';

import { CommandRunner, type CommandResult, type RunOptions } from '../lib/host/command-runner';
import { BirdManager } from '../lib/network/bird.manager';
import { LoopbackManager } from '../lib/network/loopback.manager';
import { WireguardManager } from '../lib/network/wireguard.manager';
import { DEFAULT_ENVOY_IMAGE } from '../lib/ingress/envoy-config';
import {
  renderMeshBootstrap,
  renderMeshClusters,
  renderMeshListeners,
  renderMeshSecrets,
} from '../lib/mesh/mesh-config';
import { DEFAULT_BIND9_IMAGE } from '../lib/dns/bind9-config';
import { NftablesManager } from '../lib/network/nftables.manager';
import { DEFAULT_REGISTRY_IMAGE } from '../lib/registry/registry-config';
import { LAB_IMAGE } from './lab.global-setup';

/**
 * East-west through the node proxies on real kernels and real Envoys (3.7): a workload calls a service IP, nftables
 * redirects it to its node's proxy, which talks mTLS with workload identities to the destination node's proxy; RBAC
 * there allows the policy's paths, the L7 deny wins, and workloads outside the policy get nothing.
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

describe('node proxies with mTLS (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const root = mkdtempSync(join(tmpdir(), 'lw-mesh-lab-'));
  const o = 100 + (process.pid % 50);
  const net = {
    lab: { name: `lw-mesh-lab-${run}`, subnet: `10.94.${o}.0/24` },
    pods1: { name: `lw-mesh-p1-${run}`, subnet: `10.88.${o}.0/24`, gateway: `10.88.${o}.1` },
    pods2: { name: `lw-mesh-p2-${run}`, subnet: `10.89.${o}.0/24`, gateway: `10.89.${o}.1` },
  };
  const ip = {
    n1: `10.94.${o}.11`,
    n2: `10.94.${o}.12`,
    web: `10.88.${o}.10`,
    other: `10.88.${o}.11`,
    api: `10.89.${o}.10`,
    service: '10.43.0.10',
    overlay1: `10.95.${o}.1`,
    overlay2: `10.95.${o}.2`,
  };
  const keys = { n1: generateWireguardKeyPair(), n2: generateWireguardKeyPair() };
  const names = {
    n1: `lw-mesh-n1-${run}`,
    n2: `lw-mesh-n2-${run}`,
    p1: `lw-mesh-proxy1-${run}`,
    p2: `lw-mesh-proxy2-${run}`,
    web: `lw-mesh-web-${run}`,
    other: `lw-mesh-other-${run}`,
    api: `lw-mesh-api-${run}`,
  };
  const clusterId = 'lab';
  /** Response headers (wget prints them on stderr, also for successful requests). */
  const get = (client: string, path: string): string => {
    try {
      return docker([
        'exec',
        client,
        'sh',
        '-c',
        `wget -q -S -T 5 -O /dev/null 'http://${ip.service}:5000${path}' 2>&1`,
      ]);
    } catch (error) {
      return String((error as { stdout?: string }).stdout ?? '');
    }
  };
  const status = (client: string, path: string) => /HTTP\/1\.1 (\d{3})/.exec(get(client, path))?.[1] ?? 'none';

  beforeAll(async () => {
    // Docker's bridge takes .254; the nodes own the pod gateways (.1), like lwbr0 on a node.
    docker(['network', 'create', '--subnet', net.lab.subnet, net.lab.name]);
    docker(['network', 'create', '--subnet', net.pods1.subnet, '--gateway', `10.88.${o}.254`, net.pods1.name]);
    docker(['network', 'create', '--subnet', net.pods2.subnet, '--gateway', `10.89.${o}.254`, net.pods2.name]);

    for (const [node, address, pods, gateway] of [
      [names.n1, ip.n1, net.pods1.name, net.pods1.gateway],
      [names.n2, ip.n2, net.pods2.name, net.pods2.gateway],
    ] as const) {
      docker([
        'create',
        '--name',
        node,
        '--network',
        net.lab.name,
        '--ip',
        address,
        '--cap-add',
        'NET_ADMIN',
        '--sysctl',
        'net.ipv4.ip_forward=1',
        '--memory',
        '128m',
        '-v',
        `${root}:${root}`,
        LAB_IMAGE,
      ]);
      docker(['network', 'connect', '--ip', gateway, pods, node]);
      docker(['start', node]);
    }

    docker([
      'run',
      '-d',
      '--name',
      names.api,
      '--network',
      net.pods2.name,
      '--ip',
      ip.api,
      '--memory',
      '128m',
      DEFAULT_REGISTRY_IMAGE,
    ]);

    for (const [name, address] of [
      [names.web, ip.web],
      [names.other, ip.other],
    ] as const) {
      docker([
        'run',
        '-d',
        '--name',
        name,
        '--network',
        net.pods1.name,
        '--ip',
        address,
        '--cap-add',
        'NET_ADMIN',
        '--memory',
        '64m',
        '--entrypoint',
        'sleep',
        DEFAULT_BIND9_IMAGE,
        'infinity',
      ]);
      docker(['exec', name, 'ip', 'route', 'replace', 'default', 'via', net.pods1.gateway]);
    }

    const nodes: CompilerNode[] = [
      {
        name: 'n1',
        site: 'lab',
        labels: {},
        controlPlane: false,
        witness: false,
        overlayV4: ip.overlay1,
        podSubnetV4: net.pods1.subnet,
        endpointHost: ip.n1,
        wireguardPublicKey: wireguardPublicKey(keys.n1.privateKey),
      },
      {
        name: 'n2',
        site: 'lab',
        labels: {},
        controlPlane: false,
        witness: false,
        overlayV4: ip.overlay2,
        podSubnetV4: net.pods2.subnet,
        endpointHost: ip.n2,
        wireguardPublicKey: wireguardPublicKey(keys.n2.privateKey),
      },
    ];
    const workload = (service: string, node: string, address: string) => ({
      id: `shop/${service}/0`,
      project: 'shop',
      deployment: 'shop',
      service,
      node,
      labels: { app: service },
      addresses: [address],
    });
    const result = compileNetwork({
      network: clusterNetworkSchema.parse({
        podPoolV4: '10.88.0.0/14',
        servicePoolV4: '10.43.0.0/16',
        overlayPoolV4: '10.95.0.0/16',
      }),
      nodes,
      workloads: [workload('web', 'n1', ip.web), workload('other', 'n1', ip.other), workload('api', 'n2', ip.api)],
      services: [{ project: 'shop', deployment: 'shop', name: 'api', serviceIps: [ip.service] }],
      nodeGroups: [],
      workloadGroups: ['web', 'api'].map((app) => ({
        project: 'shop',
        name: app,
        spec: { selector: { matchLabels: { app } }, intraGroup: 'allow' as const, exposed: false },
      })),
      policies: [
        {
          project: 'shop',
          name: 'web-to-api',
          spec: policySpecSchema.parse({
            from: [{ group: 'web' }],
            to: [{ group: 'api' }],
            rules: [{ ports: [5000], http: { paths: ['/v2/'] } }],
          }),
        },
        {
          project: 'shop',
          name: 'no-catalog',
          spec: policySpecSchema.parse({
            action: 'deny',
            from: [{ group: 'web' }],
            to: [{ group: 'api' }],
            rules: [{ ports: [5000], http: { paths: ['/v2/_catalog'] } }],
          }),
        },
      ],
    });

    expect(result.diagnostics.filter((d) => d.level === 'error')).toEqual([]);

    // Identities as the control plane issues them for CSRs from the nodes.
    const ca = await createCertificateAuthority({ commonName: 'lab CA', validityDays: 1 });
    const issue = async (identity: string) => {
      const keys = await generateKeyPair();
      const cert = await issueCertificate({
        ca,
        csrPem: await createCsr(keys, identity),
        clusterId,
        kind: 'workload',
        name: identity,
        validityHours: 1,
      });

      return { identity, certificatePem: cert.certificatePem, privateKeyPem: keys.privateKeyPem };
    };

    for (const [node, proxy, gateway, overlay] of [
      ['n1', names.p1, net.pods1.gateway, ip.overlay1],
      ['n2', names.p2, net.pods2.gateway, ip.overlay2],
    ] as const) {
      const config = result.nodes[node];
      const mesh = config.mesh;

      if (!mesh) throw new Error(`${node} has no mesh configuration`);

      const held = await Promise.all(mesh.identities.map(issue));
      const ready = new Set(held.map((h) => h.identity));
      const dir = join(root, node);

      for (const d of [dir, join(dir, 'dynamic'), join(dir, 'secrets')]) {
        mkdirSync(d, { recursive: true });
        chmodSync(d, 0o755);
      }

      writeFileSync(join(dir, 'bootstrap.json'), renderMeshBootstrap(node), { mode: 0o644 });
      for (const [file, content] of renderMeshSecrets(held, ca.certificatePem))
        writeFileSync(join(dir, 'secrets', file), content, { mode: 0o644 });
      writeFileSync(join(dir, 'dynamic', 'cds.json'), renderMeshClusters(mesh, { clusterId, ready }), { mode: 0o644 });
      writeFileSync(
        join(dir, 'dynamic', 'lds.json'),
        renderMeshListeners(mesh, { clusterId, gateways: [gateway], overlay: [overlay], ready }),
        { mode: 0o644 },
      );
      // The node's network as the agent builds it: overlay on lw0, WireGuard links, BGP routes, filtering.
      const container = node === 'n1' ? names.n1 : names.n2;
      const runner = new ContainerCommandRunner(container);

      mkdirSync(join(dir, 'bird'), { recursive: true });
      writeFileSync(join(dir, 'wireguard.key'), `${keys[node].privateKey}\n`, { mode: 0o600 });
      writeFileSync(join(dir, 'bird', 'bird.conf'), `router id ${overlay};\nprotocol device {}\n`);
      docker(['exec', container, 'bird', '-c', join(dir, 'bird', 'bird.conf')]);
      process.env['LOADWEAVER_BIRD_CONFIG'] = join(dir, 'bird', 'bird.conf');
      await new LoopbackManager(runner).apply(config.addresses);
      await new WireguardManager(runner, { wireguardKeyPath: () => join(dir, 'wireguard.key') } as never).apply(
        config.wireguard,
      );
      await new BirdManager(runner).apply(config);
      await new NftablesManager(runner).apply(config);
      docker([
        'run',
        '-d',
        '--name',
        proxy,
        '--network',
        `container:${node === 'n1' ? names.n1 : names.n2}`,
        '--memory',
        '256m',
        '--cap-drop',
        'ALL',
        '--read-only',
        '--tmpfs',
        '/tmp',
        '--security-opt',
        'no-new-privileges:true',
        '-e',
        'ENVOY_UID=0',
        '-v',
        `${dir}/bootstrap.json:/etc/envoy/bootstrap.json:ro`,
        '-v',
        `${dir}/dynamic:/etc/envoy/dynamic:ro`,
        '-v',
        `${dir}/secrets:/etc/envoy/secrets:ro`,
        // Lab: the run dir belongs to the test user; root without capabilities can't write there.
        '--tmpfs',
        '/etc/envoy/run',
        DEFAULT_ENVOY_IMAGE,
        'envoy',
        '-c',
        '/etc/envoy/bootstrap.json',
        '--log-level',
        'warn',
        '--concurrency',
        '1',
      ]);
    }

    for (let i = 0; i < 60 && status(names.web, '/v2/') !== '200'; i++) await new Promise((r) => setTimeout(r, 500));
  }, 240_000);

  afterAll(() => {
    if (process.env['LW_LAB_KEEP'] === '1') return;

    for (const name of Object.values(names)) {
      try {
        docker(['rm', '-f', name]);
      } catch {
        // gone
      }
    }

    for (const n of Object.values(net)) {
      try {
        docker(['network', 'rm', n.name]);
      } catch {
        // gone
      }
    }

    rmSync(root, { recursive: true, force: true });
  });

  it('carries allowed requests from the workload through both proxies with mTLS', () => {
    expect(status(names.web, '/v2/')).toBe('200');
  });

  it('applies the L7 rules at the destination: deny wins, and only the allowed paths pass', () => {
    expect(status(names.web, '/v2/_catalog')).toBe('403');
    expect(status(names.web, '/metrics')).toBe('403');
    // Path tricks are normalized before the rules see them.
    expect(status(names.web, '/v2//_catalog')).toBe('403');
  });

  it('gives workloads outside the policy nothing, and leaves no direct path around the proxies', () => {
    expect(status(names.other, '/v2/')).toBe('none');
    // Straight to the replica's pod address: the direct path is closed for meshed ports.
    expect(() =>
      docker(['exec', names.web, 'wget', '-q', '-T', '3', '-O', '/dev/null', `http://${ip.api}:5000/v2/`]),
    ).toThrow();
  });

  it('refuses connections to the inbound listener without a workload identity', () => {
    // Straight from node 1 to node 2's proxy, without a client certificate: the TLS handshake fails.
    expect(() =>
      docker([
        'exec',
        names.web,
        'wget',
        '-q',
        '-T',
        '5',
        '-O',
        '/dev/null',
        '--no-check-certificate',
        `https://${ip.overlay2}:15443/v2/`,
      ]),
    ).toThrow();
  });
});
