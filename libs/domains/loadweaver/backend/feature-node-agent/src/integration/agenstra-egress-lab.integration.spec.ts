import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Contract between the products (Loadweaver plan, section 4): Agenstra's effective egress policy, compiled into
// Loadweaver policies, must decide exactly like Agenstra's own evaluation. The test needs both sides.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  compileEgressPolicyForLoadweaver,
  evaluateEgressDestination,
  loadweaverWorkspacePolicies,
  normalizeEffectiveEgressPolicy,
  resolveEffectiveEgressPolicy,
  type EffectiveEgressPolicy,
} from '@forepath/agenstra/shared/util-opencode-config';
import { clusterNetworkSchema, policySpecSchema } from '@forepath/loadweaver/shared/util-model';
import {
  createCertificateAuthority,
  createServerCsr,
  generateKeyPair,
  issueCertificate,
} from '@forepath/loadweaver/shared/util-pki';
import { compileNetwork, type CompilerInput, type NamedPolicy } from '@forepath/loadweaver/shared/util-policy-compiler';

import { CommandRunner, type CommandResult, type RunOptions } from '../lib/host/command-runner';
import { DEFAULT_BIND9_IMAGE } from '../lib/dns/bind9-config';
import { DEFAULT_ENVOY_IMAGE } from '../lib/ingress/envoy-config';
import { parseEgressDecision } from '../lib/logs/log-parsing';
import { renderMeshBootstrap, renderMeshClusters, renderMeshListeners } from '../lib/mesh/mesh-config';
import { NftablesManager } from '../lib/network/nftables.manager';
import { LAB_IMAGE } from './lab.global-setup';

/**
 * Agenstra's egress semantics on Loadweaver (section 4, step 2), table-driven against a real Envoy and real nftables:
 * for each Agenstra policy and each destination (allow-listed host and subdomain, denied host and address, other
 * host, public and private IP literals, plain-HTTP URL patterns, HTTP and TLS), the decision and rule of Loadweaver's
 * node proxy (from its access log, as the node attributes it) equal `evaluateEgressDestination`.
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

const entry = (value: string) => ({ value, source: 'workspace' as const });
const policyOf = (overrides: Record<string, unknown>): EffectiveEgressPolicy =>
  normalizeEffectiveEgressPolicy({ ...resolveEffectiveEgressPolicy([]), ...overrides });

describe("Agenstra's egress policy on Loadweaver's node proxy (lab)", () => {
  const run = `${process.pid}-${Date.now()}`;
  const root = mkdtempSync(join(tmpdir(), 'lw-agenstra-egress-'));
  const o = 150 + (process.pid % 50);
  const net = {
    pods: { name: `lw-ae-p-${run}`, subnet: `10.88.${o}.0/24`, gateway: `10.88.${o}.1` },
    internet: { name: `lw-ae-i-${run}`, subnet: '203.0.113.0/24' },
    // A private destination that answers (10.1.2.3), so allowed private requests end and get logged promptly.
    private: { name: `lw-ae-x-${run}`, subnet: '10.1.2.0/24' },
    // The names resolve to another public address of the server than the allow-listed IP literal: Agenstra's guard
    // (Squid `dst`) and Loadweaver both allow any name resolving to an allowed IP, while `evaluateEgressDestination`
    // only sees the name, so the two must not coincide here.
    web: { name: `lw-ae-w-${run}`, subnet: '198.51.100.0/24' },
  };
  const ip = {
    node: '203.0.113.2',
    server: '203.0.113.80',
    other: '203.0.113.81',
    env: `10.88.${o}.10`,
    web: '198.51.100.80',
  };
  const names = {
    node: `lw-ae-n-${run}`,
    proxy: `lw-ae-proxy-${run}`,
    server: `lw-ae-srv-${run}`,
    env: `lw-ae-env-${run}`,
  };
  const hosts = ['allowed.example', 'sub.allowed.example', 'blocked.allowed.example', 'other.example'];
  const project = 'agenstra-ws';
  const deployment = 'env-0123456789abcdef0123456789abcdef';
  let logLines = 0;

  /** The Loadweaver policies of an environment for an Agenstra policy: standing ones plus the compiled ones. */
  const loadweaverPolicies = (policy: EffectiveEgressPolicy) => {
    const compiled = compileEgressPolicyForLoadweaver(policy, { project, deployment });

    expect(compiled.issues).toEqual([]);

    // Contract: every document is a valid Loadweaver policy.
    const named: NamedPolicy[] = [...loadweaverWorkspacePolicies(project), ...compiled.documents].map((d) => ({
      project,
      name: d.metadata.name,
      spec: policySpecSchema.parse(d.spec),
    }));

    return { named, network: compiled.network };
  };

  const input = (policy: EffectiveEgressPolicy): CompilerInput => {
    const { named, network } = loadweaverPolicies(policy);

    return {
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
          id: `${project}/${deployment}/worker/0`,
          project,
          deployment,
          service: 'worker',
          node: 'n1',
          labels: {
            'loadweaver.com/project': project,
            'loadweaver.com/deployment': deployment,
            'loadweaver.com/service': 'worker',
            'agenstra.io/role': 'environment',
            'agenstra.io/egress-network': network,
          },
          addresses: [ip.env],
        },
      ],
      services: [],
      nodeGroups: [],
      workloadGroups: [],
      policies: named,
      // The cluster leaves egress alone: only the environment's policies filter it.
      egressFilter: { mode: 'off', blockPrivateNetworks: true, blockIpLiterals: false, logAllowed: true },
    };
  };

  /** Renders the proxy for a policy and (re)starts it, as the agent would. */
  const apply = async (label: string, policy: EffectiveEgressPolicy) => {
    const config = compileNetwork(input(policy)).nodes['n1'];
    const dir = join(root, label);

    expect(config.egressFilter).toBeDefined();

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
    logLines = 0;

    // Ready once the listeners answer (any decision is logged).
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));

      if (/"kind":"egress-http"/.test(proxyLog())) break;

      fetch('http://other.example/');
    }

    logLines = proxyLog().split('\n').length;
  };

  const proxyLog = () => {
    try {
      return execFileSync('docker', ['logs', names.proxy], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return '';
    }
  };

  const fetch = (url: string) => {
    try {
      docker(['exec', names.env, 'sh', '-c', `wget -q -T 4 --no-check-certificate -O /dev/null '${url}' 2>&1`]);
    } catch {
      // the decision is in the proxy's log
    }
  };

  /**
   * The proxy's decision for one request, from its access log line for exactly that request (kind, host or, for TLS
   * without SNI, destination address). TLS lines arrive when the connection closes.
   */
  const decide = async (url: string) => {
    const parsed = new URL(url);
    const tls = parsed.protocol === 'https:';
    const literal = /^[0-9.]+$/.test(parsed.hostname);
    const ours = (line: string) => {
      try {
        const entry = JSON.parse(line) as { kind?: string; host?: string; destination?: string };
        const host = (entry.host ?? '').toLowerCase();

        return (
          entry.kind === (tls ? 'egress-tls' : 'egress-http') &&
          (tls && literal
            ? // Clients differ: no SNI for an IP literal (RFC 6066) or the literal itself (BusyBox wget).
              (host === '' || host === '-' || host === parsed.hostname) &&
              (entry.destination ?? '').startsWith(`${parsed.hostname}:`)
            : host === parsed.hostname)
        );
      } catch {
        return false;
      }
    };

    fetch(url);

    for (let i = 0; i < 40; i++) {
      const lines = proxyLog().split('\n');
      const index = lines.findIndex((l, n) => n >= logLines - 1 && l.startsWith('{"') && ours(l));
      const decision = index >= 0 ? parseEgressDecision(lines[index]) : null;

      if (decision) {
        // The next search starts after this line (`n >= logLines - 1`).
        logLines = index + 2;

        return { decision: decision.decision, rule: decision.rule };
      }

      await new Promise((r) => setTimeout(r, 250));
    }

    throw new Error(`no proxy decision logged for ${url}`);
  };

  /** Agenstra's evaluation of the same request. */
  const expected = (policy: EffectiveEgressPolicy, url: string) => {
    const parsed = new URL(url);
    const scheme = parsed.protocol === 'https:' ? 'https' : 'http';
    const result = evaluateEgressDestination(policy, parsed.hostname, {
      url: `${scheme}://${parsed.host}${parsed.pathname}`,
      scheme,
    });

    return { decision: result.decision, rule: result.decision === 'allowed' ? null : result.rule };
  };

  const destinations = [
    ...hosts.flatMap((h) => [`http://${h}/`, `https://${h}/`]),
    `http://${ip.server}/`,
    `https://${ip.server}/`,
    `http://${ip.other}/`,
    'http://10.1.2.3/',
    'https://10.1.2.3/',
    'http://allowed.example/admin/secret',
    'http://allowed.example/public/admin',
    // Upper-case path (patterns match case-insensitively); the host stays lower-case since the BusyBox resolver
    // looks up /etc/hosts case-sensitively.
    'http://allowed.example/ADMIN/x',
  ];
  const lists = {
    allowHosts: [entry('allowed.example'), entry(ip.server)],
    denyHosts: [entry('blocked.allowed.example'), entry(ip.other)],
    denyUrlPatterns: [entry('^http://[^/]+/admin/')],
  };
  const policies: Record<string, EffectiveEgressPolicy> = {
    'enforce with allow / deny lists and URL patterns': policyOf({ mode: 'enforce', ...lists }),
    'monitor with the same lists': policyOf({ mode: 'monitor', ...lists }),
    'enforce without allow list, IP literals blocked': policyOf({
      mode: 'enforce',
      denyHosts: [entry('other.example')],
      blockIpLiterals: true,
    }),
    'enforce with an explicit private allow (lifts private and IP-literal blocks)': policyOf({
      mode: 'enforce',
      allowHosts: [entry('10.1.2.0/24'), entry('*.allowed.example')],
      blockIpLiterals: true,
    }),
    offline: policyOf({ mode: 'offline', ...lists }),
  };

  beforeAll(async () => {
    docker(['network', 'create', '--subnet', net.pods.subnet, '--gateway', `10.88.${o}.254`, net.pods.name]);
    docker(['network', 'create', '--subnet', net.internet.subnet, net.internet.name]);
    docker(['network', 'create', '--subnet', net.private.subnet, net.private.name]);
    docker(['network', 'create', '--subnet', net.web.subnet, net.web.name]);
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
      ...hosts.flatMap((h) => ['--add-host', `${h}:${ip.web}`]),
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
    docker(['network', 'connect', '--ip', '10.1.2.3', net.private.name, names.server]);
    docker(['network', 'connect', '--ip', '10.1.2.2', net.private.name, names.node]);
    docker(['network', 'connect', '--ip', ip.web, net.web.name, names.server]);
    docker(['network', 'connect', '--ip', '198.51.100.2', net.web.name, names.node]);
    docker([
      'run',
      '-d',
      '--name',
      names.env,
      '--network',
      net.pods.name,
      '--ip',
      ip.env,
      '--cap-add',
      'NET_ADMIN',
      '--memory',
      '64m',
      ...hosts.flatMap((h) => ['--add-host', `${h}:${ip.web}`]),
      '--entrypoint',
      'sleep',
      DEFAULT_BIND9_IMAGE,
      'infinity',
    ]);
    docker(['exec', names.env, 'ip', 'route', 'replace', 'default', 'via', net.pods.gateway]);
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

  it.each(Object.keys(policies))(
    'decides like Agenstra: %s',
    async (label) => {
      const policy = policies[label];

      await apply(label.replace(/[^a-z]+/gi, '-'), policy);

      const mismatches: string[] = [];

      for (const url of destinations) {
        const want = expected(policy, url);
        const got = await decide(url);

        if (got.decision !== want.decision || got.rule !== want.rule)
          mismatches.push(`${url}: Agenstra ${want.decision}/${want.rule}, Loadweaver ${got.decision}/${got.rule}`);
      }

      expect(mismatches).toEqual([]);
    },
    600_000,
  );
});
