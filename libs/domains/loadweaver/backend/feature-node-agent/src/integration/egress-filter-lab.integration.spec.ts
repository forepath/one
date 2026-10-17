import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clusterNetworkSchema, policySpecSchema } from '@forepath/loadweaver/shared/util-model';
import {
  createCertificateAuthority,
  createServerCsr,
  generateKeyPair,
  issueCertificate,
} from '@forepath/loadweaver/shared/util-pki';
import { compileNetwork, type CompilerInput } from '@forepath/loadweaver/shared/util-policy-compiler';

import { CommandRunner, type CommandResult, type RunOptions } from '../lib/host/command-runner';
import { DEFAULT_BIND9_IMAGE } from '../lib/dns/bind9-config';
import { DEFAULT_ENVOY_IMAGE } from '../lib/ingress/envoy-config';
import { renderMeshBootstrap, renderMeshClusters, renderMeshListeners } from '../lib/mesh/mesh-config';
import { NftablesManager } from '../lib/network/nftables.manager';
import { LAB_IMAGE } from './lab.global-setup';

/**
 * Web egress filtering through the node proxy on real kernels and a real Envoy (3.7): HTTP decided by Host, TLS by
 * SNI without decryption, deny wins, only allow-listed hosts pass in `enforce`, everything passes (and is recorded)
 * in `monitor`.
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

describe('egress filtering through the node proxy (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const root = mkdtempSync(join(tmpdir(), 'lw-egress-filter-'));
  const o = 100 + (process.pid % 50);
  const net = {
    pods: { name: `lw-ef-p-${run}`, subnet: `10.88.${o}.0/24`, gateway: `10.88.${o}.1` },
    internet: { name: `lw-ef-i-${run}`, subnet: `198.19.${o}.0/24` },
  };
  const ip = { node: `198.19.${o}.2`, server: `198.19.${o}.80`, evil: `198.19.${o}.81`, web: `10.88.${o}.10` };
  const names = {
    node: `lw-ef-n-${run}`,
    proxy: `lw-ef-proxy-${run}`,
    server: `lw-ef-srv-${run}`,
    evil: `lw-ef-evil-${run}`,
    web: `lw-ef-web-${run}`,
  };
  const hosts = ['github.com', 'gist.github.com', 'other.example'];
  let input: CompilerInput;

  const fetch = (url: string): string => {
    try {
      return docker(['exec', names.web, 'sh', '-c', `wget -q -S -T 5 --no-check-certificate -O - '${url}' 2>&1`]);
    } catch (error) {
      return `failed ${String((error as { stdout?: string }).stdout ?? '')}`;
    }
  };
  const status = (url: string) =>
    fetch(url).includes('HTTP/1.1 200') ? 'ok' : (/HTTP\/1\.1 (\d{3})/.exec(fetch(url))?.[1] ?? 'blocked');

  /** Renders the proxy for a mode and (re)starts it, as the agent would. */
  const apply = async (mode: 'enforce' | 'monitor', logAllowed = true) => {
    const result = compileNetwork({
      ...input,
      egressFilter: { mode, blockPrivateNetworks: true, blockIpLiterals: false, logAllowed },
    });
    const config = result.nodes['n1'];
    const dir = join(root, `${mode}-${logAllowed}`);

    for (const d of [dir, join(dir, 'dynamic')]) {
      mkdirSync(d, { recursive: true });
      chmodSync(d, 0o755);
    }

    writeFileSync(join(dir, 'bootstrap.json'), renderMeshBootstrap('n1'), { mode: 0o644 });
    writeFileSync(
      join(dir, 'dynamic', 'cds.json'),
      renderMeshClusters(undefined, { clusterId: 'lab', ready: new Set(), egressFilter: config.egressFilter }),
      { mode: 0o644 },
    );
    writeFileSync(
      join(dir, 'dynamic', 'lds.json'),
      renderMeshListeners(undefined, {
        clusterId: 'lab',
        gateways: [net.pods.gateway],
        overlay: [],
        ready: new Set(),
        egressFilter: config.egressFilter,
      }),
      { mode: 0o644 },
    );
    await new NftablesManager(new ContainerCommandRunner(names.node)).apply(config);

    try {
      docker(['rm', '-f', names.proxy]);
    } catch {
      // first start
    }

    docker([
      'run',
      '-d',
      '--name',
      names.proxy,
      '--network',
      `container:${names.node}`,
      '--memory',
      '256m',
      '--cap-drop',
      'ALL',
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--tmpfs',
      '/etc/envoy/run',
      '--security-opt',
      'no-new-privileges:true',
      '-e',
      'ENVOY_UID=0',
      '-v',
      `${dir}/bootstrap.json:/etc/envoy/bootstrap.json:ro`,
      '-v',
      `${dir}/dynamic:/etc/envoy/dynamic:ro`,
      DEFAULT_ENVOY_IMAGE,
      'envoy',
      '-c',
      '/etc/envoy/bootstrap.json',
      '--log-level',
      'warn',
      '--concurrency',
      '1',
    ]);

    for (let i = 0; i < 40 && status('http://github.com/') !== 'ok'; i++) await new Promise((r) => setTimeout(r, 500));
  };

  beforeAll(async () => {
    docker(['network', 'create', '--subnet', net.pods.subnet, '--gateway', `10.88.${o}.254`, net.pods.name]);
    docker(['network', 'create', '--subnet', net.internet.subnet, net.internet.name]);
    docker([
      'create',
      '--name',
      names.node,
      '--network',
      net.internet.name,
      '--ip',
      ip.node,
      '--cap-add',
      'NET_ADMIN',
      '--sysctl',
      'net.ipv4.ip_forward=1',
      '--memory',
      '128m',
      // The node (and its proxy, which shares the network namespace and hosts file) resolves the "internet".
      ...hosts.flatMap((h) => ['--add-host', `${h}:${ip.server}`]),
      LAB_IMAGE,
    ]);
    docker(['network', 'connect', '--ip', net.pods.gateway, net.pods.name, names.node]);
    docker(['start', names.node]);

    // The "internet": one server answering HTTP on 80 and TLS on 443 for every name.
    const ca = await createCertificateAuthority({ commonName: 'lab', validityDays: 1 });
    const keys = await generateKeyPair();
    const cert = await issueCertificate({
      ca,
      csrPem: (await createServerCsr(keys, hosts)).pem,
      clusterId: 'lab',
      kind: 'node',
      name: 'server',
      dnsNames: hosts,
      validityHours: 1,
    });
    const serverDir = join(root, 'server');

    mkdirSync(serverDir, { recursive: true });
    chmodSync(serverDir, 0o755);
    writeFileSync(join(serverDir, 'cert.pem'), cert.certificatePem, { mode: 0o644 });
    writeFileSync(join(serverDir, 'key.pem'), keys.privateKeyPem, { mode: 0o644 });
    const ok = { match: { prefix: '/' }, direct_response: { status: 200, body: { inline_string: 'ok' } } };
    const hcm = (name: string) => ({
      name: 'envoy.filters.network.http_connection_manager',
      typed_config: {
        '@type':
          'type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager',
        stat_prefix: name,
        route_config: { virtual_hosts: [{ name: 'all', domains: ['*'], routes: [ok] }] },
        http_filters: [
          {
            name: 'envoy.filters.http.router',
            typed_config: { '@type': 'type.googleapis.com/envoy.extensions.filters.http.router.v3.Router' },
          },
        ],
      },
    });
    writeFileSync(
      join(serverDir, 'envoy.json'),
      JSON.stringify({
        static_resources: {
          listeners: [
            {
              name: 'http',
              address: { socket_address: { address: '0.0.0.0', port_value: 80 } },
              filter_chains: [{ filters: [hcm('http')] }],
            },
            {
              name: 'https',
              address: { socket_address: { address: '0.0.0.0', port_value: 443 } },
              filter_chains: [
                {
                  transport_socket: {
                    name: 'envoy.transport_sockets.tls',
                    typed_config: {
                      '@type': 'type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext',
                      common_tls_context: {
                        tls_certificates: [
                          {
                            certificate_chain: { filename: '/srv/cert.pem' },
                            private_key: { filename: '/srv/key.pem' },
                          },
                        ],
                      },
                    },
                  },
                  filters: [hcm('https')],
                },
              ],
            },
          ],
        },
      }),
      { mode: 0o644 },
    );
    docker([
      'run',
      '-d',
      '--name',
      names.server,
      '--network',
      net.internet.name,
      '--ip',
      ip.server,
      '--memory',
      '128m',
      '-e',
      'ENVOY_UID=0',
      '-v',
      `${serverDir}:/srv:ro`,
      DEFAULT_ENVOY_IMAGE,
      'envoy',
      '-c',
      '/srv/envoy.json',
      '--log-level',
      'warn',
    ]);
    // An attacker's server elsewhere on the internet, answering the same names.
    writeFileSync(
      join(serverDir, 'evil.json'),
      readFileSync(join(serverDir, 'envoy.json'), 'utf8').replace(/"inline_string":"ok"/g, '"inline_string":"evil"'),
      { mode: 0o644 },
    );
    docker([
      'run',
      '-d',
      '--name',
      names.evil,
      '--network',
      net.internet.name,
      '--ip',
      ip.evil,
      '--memory',
      '128m',
      '-e',
      'ENVOY_UID=0',
      '-v',
      `${serverDir}:/srv:ro`,
      DEFAULT_ENVOY_IMAGE,
      'envoy',
      '-c',
      '/srv/evil.json',
      '--log-level',
      'warn',
    ]);

    docker([
      'run',
      '-d',
      '--name',
      names.web,
      '--network',
      net.pods.name,
      '--ip',
      ip.web,
      '--cap-add',
      'NET_ADMIN',
      '--memory',
      '64m',
      ...hosts.flatMap((h) => ['--add-host', `${h}:${ip.server}`]),
      '--entrypoint',
      'sleep',
      DEFAULT_BIND9_IMAGE,
      'infinity',
    ]);
    docker(['exec', names.web, 'ip', 'route', 'replace', 'default', 'via', net.pods.gateway]);
    // The node routes the pod network out (masquerade isn't needed: the proxy connects from the node itself).

    input = {
      network: clusterNetworkSchema.parse({
        podPoolV4: '10.88.0.0/16',
        servicePoolV4: '10.43.0.0/16',
        overlayPoolV4: '10.95.0.0/16',
      }),
      nodes: [
        {
          name: 'n1',
          site: 'lab',
          labels: {},
          controlPlane: false,
          witness: false,
          overlayV4: `10.95.${o}.1`,
          podSubnetV4: net.pods.subnet,
          endpointHost: ip.node,
          wireguardPublicKey: 'k',
        },
      ],
      workloads: [
        {
          id: 'shop/web/0',
          project: 'shop',
          deployment: 'shop',
          service: 'web',
          node: 'n1',
          labels: { app: 'web' },
          addresses: [ip.web],
        },
      ],
      services: [],
      nodeGroups: [],
      workloadGroups: [
        {
          project: 'shop',
          name: 'web',
          spec: { selector: { matchLabels: { app: 'web' } }, intraGroup: 'allow', exposed: false },
        },
      ],
      policies: [
        {
          project: 'shop',
          name: 'web-out',
          spec: policySpecSchema.parse({
            from: [{ group: 'web' }],
            to: [{ builtin: 'internet' }],
            rules: [{ ports: [80, 443] }],
          }),
        },
        {
          project: 'shop',
          name: 'github',
          spec: policySpecSchema.parse({
            from: [{ group: 'web' }],
            to: [{ host: 'github.com' }],
            rules: [{ ports: [80, 443] }],
          }),
        },
        {
          project: 'shop',
          name: 'no-gists',
          spec: policySpecSchema.parse({
            action: 'deny',
            from: [{ group: 'web' }],
            to: [{ host: 'gist.github.com' }],
            rules: [{ ports: [80, 443] }],
          }),
        },
      ],
    };
    await apply('enforce');
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

  it('lets allow-listed hosts through, by Host for HTTP and by SNI for TLS', () => {
    expect(status('http://github.com/')).toBe('ok');
    expect(status('https://github.com/')).toBe('ok');
  });

  it('blocks denied hosts (deny wins over the parent domain) and hosts not on the allow list', () => {
    expect(status('http://gist.github.com/')).toBe('403');
    expect(status('https://gist.github.com/')).toBe('blocked');
    expect(status('http://other.example/')).toBe('403');
    expect(status('https://other.example/')).toBe('blocked');
  });

  it('sends allowed names to the host itself, wherever the workload connects', () => {
    // The workload resolves github.com to the attacker's server and sends the allowed name there.
    docker([
      'exec',
      names.web,
      'sh',
      '-c',
      `sed 's/^.*github.com$//' /etc/hosts > /tmp/h && cat /tmp/h > /etc/hosts && echo '${ip.evil} github.com' >> /etc/hosts`,
    ]);

    try {
      for (const url of ['http://github.com/', 'https://github.com/']) {
        const body = fetch(url);

        expect(body).toContain('ok');
        expect(body).not.toContain('evil');
      }
    } finally {
      docker([
        'exec',
        names.web,
        'sh',
        '-c',
        `sed 's/^.*github.com$//' /etc/hosts > /tmp/h && cat /tmp/h > /etc/hosts && echo '${ip.server} github.com' >> /etc/hosts && echo '${ip.server} gist.github.com' >> /etc/hosts`,
      ]);
    }
  });

  it('logs only denials without logAllowed', async () => {
    await apply('enforce', false);

    expect(status('http://github.com/')).toBe('ok');
    expect(status('https://github.com/')).toBe('ok');
    expect(status('http://other.example/')).toBe('403');
    expect(status('https://gist.github.com/')).toBe('blocked');

    const logs = async (until: string) => {
      let text = '';

      for (let i = 0; i < 20 && !text.includes(until); i++) {
        await new Promise((r) => setTimeout(r, 500));
        text = execFileSync('docker', ['logs', names.proxy], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      }

      return text;
    };
    const text = await logs('"host":"gist.github.com"');

    expect(text).toContain('"host":"other.example"');
    expect(text).toContain('"host":"gist.github.com"');
    expect(text).not.toContain('"host":"github.com"');
  }, 120_000);

  it('only records in monitor mode', async () => {
    await apply('monitor');

    expect(status('http://gist.github.com/')).toBe('ok');
    expect(status('https://other.example/')).toBe('ok');
    // Decisions are logged (TLS connections when they close).
    let logs = '';

    for (let i = 0; i < 20 && !logs.includes('"host":"other.example"'); i++) {
      await new Promise((r) => setTimeout(r, 500));
      logs = execFileSync('docker', ['logs', names.proxy], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    }

    expect(logs).toContain('"host":"other.example"');
  }, 120_000);
});
