import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decodeAgentMessage,
  type Envelope,
  type NodeNetworkConfig,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  createCertificateAuthority,
  generateKeyPair,
  issueCertificate,
  createCsr,
} from '@forepath/loadweaver/shared/util-pki';

import {
  renderEgressClusters,
  renderEgressListeners,
  renderMeshClusters,
  renderMeshListeners,
  renderMeshSecrets,
  secretFile,
  workloadUri,
} from './mesh-config';
import { renderNftables } from '../network/nftables.renderer';
import { networkConfig } from '../test-fixtures';
import { WorkloadIdentityManager } from './workload-identity.manager';

type Mesh = NonNullable<NodeNetworkConfig['mesh']>;

const mesh: Mesh = {
  identities: ['shop/shop/api', 'shop/shop/web'],
  outbound: [
    {
      source: '10.88.1.10',
      identity: 'shop/shop/web',
      serviceIp: '10.43.0.10',
      port: 8080,
      upstream: 'shop/shop/api:8080',
    },
  ],
  upstreams: [
    {
      name: 'shop/shop/api:8080',
      sni: '8080.api.shop.shop.mesh.lw',
      identity: 'shop/shop/api',
      endpoints: ['10.44.0.2'],
    },
  ],
  inbound: [
    {
      sni: '8080.api.shop.shop.mesh.lw',
      identity: 'shop/shop/api',
      port: 8080,
      backends: ['10.42.2.10'],
      http: true,
      rules: [
        {
          identity: 'shop/shop/web',
          policy: 'shop/web-to-api',
          mode: 'enforce',
          action: 'allow',
          http: { paths: ['/v1/'], methods: ['GET'] },
        },
        {
          identity: 'shop/shop/web',
          policy: 'shop/no-admin',
          mode: 'enforce',
          action: 'deny',
          http: { paths: ['/v1/admin'] },
        },
        {
          identity: 'shop/shop/batch',
          policy: 'shop/try',
          mode: 'monitor',
          action: 'deny',
          http: { hosts: ['*.example.com'] },
        },
      ],
    },
  ],
};
const ready = new Set(mesh.identities);

describe('mesh proxy configuration', () => {
  const listeners = JSON.parse(
    renderMeshListeners(mesh, { clusterId: 'c1', gateways: ['10.88.1.1'], overlay: ['10.44.0.1'], ready }),
  ).resources;

  it('takes local service traffic by original destination and source, and answers by SNI with mTLS', () => {
    const outbound = listeners.find((l: { name: string }) => l.name === 'mesh_out_10.88.1.1');
    const inbound = listeners.find((l: { name: string }) => l.name === 'mesh_in_10.44.0.1');

    expect(outbound.address.socket_address).toEqual({ address: '10.88.1.1', port_value: 15001 });
    expect(outbound.filter_chains[0].filter_chain_match).toEqual({
      prefix_ranges: [{ address_prefix: '10.43.0.10', prefix_len: 32 }],
      source_prefix_ranges: [{ address_prefix: '10.88.1.10', prefix_len: 32 }],
      destination_port: 8080,
    });
    expect(inbound.filter_chains[0].filter_chain_match).toEqual({ server_names: ['8080.api.shop.shop.mesh.lw'] });
    expect(inbound.filter_chains[0].transport_socket.typed_config.require_client_certificate).toBe(true);
    expect(JSON.stringify(inbound)).toContain('spiffe://c1.loadweaver/workload/');
  });

  it('applies denies before allows, monitor denies only as shadow rules', () => {
    const hcm = listeners.find((l: { name: string }) => l.name === 'mesh_in_10.44.0.1').filter_chains[0].filters[0]
      .typed_config;
    const [deny, allow] = hcm.http_filters;

    expect(hcm.normalize_path).toBe(true);
    expect(deny.typed_config.rules.action).toBe('DENY');
    expect(Object.keys(deny.typed_config.rules.policies)).toEqual(['0:shop/no-admin']);
    expect(Object.keys(deny.typed_config.shadow_rules.policies)).toEqual(['0:shop/try']);
    expect(allow.typed_config.rules.action).toBe('ALLOW');
    expect(allow.typed_config.rules.policies['0:shop/web-to-api']).toEqual({
      permissions: [
        {
          and_rules: {
            rules: [
              { url_path: { path: { prefix: '/v1/' } } },
              { header: { name: ':method', string_match: { exact: 'GET' } } },
            ],
          },
        },
      ],
      principals: [{ authenticated: { principal_name: { exact: workloadUri('c1', 'shop/shop/web') } } }],
    });
    expect(JSON.stringify(deny.typed_config.shadow_rules)).toContain('"suffix":".example.com"');
  });

  it('verifies the destination identity upstream and leaves out identities without a certificate', () => {
    const clusters = JSON.parse(renderMeshClusters(mesh, { clusterId: 'c1', ready })).resources;
    const out = clusters.find((c: { name: string }) => c.name.startsWith('out|'));

    expect(out.transport_socket.typed_config.sni).toBe('8080.api.shop.shop.mesh.lw');
    expect(JSON.stringify(out)).toContain(workloadUri('c1', 'shop/shop/api'));
    expect(JSON.parse(renderMeshClusters(mesh, { clusterId: 'c1', ready: new Set() })).resources).toEqual([]);
    expect(
      JSON.parse(
        renderMeshListeners(mesh, {
          clusterId: 'c1',
          gateways: ['10.88.1.1'],
          overlay: ['10.44.0.1'],
          ready: new Set(),
        }),
      ).resources,
    ).toEqual([]);
  });

  it('keeps one secret per file', () => {
    const files = renderMeshSecrets([{ identity: 'shop/shop/api', certificatePem: 'C', privateKeyPem: 'K' }], 'CA');

    expect([...files.keys()]).toEqual([secretFile('cluster-ca'), secretFile('id:shop/shop/api')]);
    expect(JSON.parse(files.get(secretFile('id:shop/shop/api')) as string).resources).toHaveLength(1);
  });
});

describe('egress filtering', () => {
  type Filter = NonNullable<NodeNetworkConfig['egressFilter']>;
  const filter = (mode: Filter['mode'], extra: Partial<Filter['sources'][number]> = {}): Filter => ({
    mode,
    blockPrivateNetworks: true,
    blockIpLiterals: true,
    logAllowed: true,
    clusterRanges: ['10.42.0.0/16', '10.43.0.0/16'],
    sources: [
      {
        address: '10.42.1.10',
        ports: [
          { port: 80, destinations: ['0.0.0.0/0'] },
          { port: 443, destinations: ['0.0.0.0/0'] },
        ],
        allow: [{ host: 'github.com', ports: [80, 443], policy: 'shop/github', monitor: false }],
        deny: [{ host: '*.gist.github.com', ports: [443], policy: 'shop/no', monitor: false }],
        allowCidrs: [],
        unrestricted: false,
        ...extra,
      },
    ],
  });
  const chains = (f: Filter) => {
    const listeners = renderEgressListeners(f, ['10.42.1.1']) as {
      name: string;
      filter_chains: { filters: { typed_config: Record<string, unknown> }[] }[];
    }[];

    return Object.fromEntries(listeners.map((l) => [l.name.split('_')[1], l.filter_chains[0].filters]));
  };

  it('denies before allowing, matching hosts and their subdomains', () => {
    const tls = chains(filter('enforce')).tls;
    const [deny, allow] = tls.map((f) => JSON.stringify(f.typed_config));

    expect(deny).toContain('"action":"DENY"');
    expect(deny).toContain('(?i)^([^.:]+\\\\.)+gist\\\\.github\\\\.com$');
    expect(deny).toContain('"address_prefix":"10.0.0.0"');
    expect(deny).toContain('"requested_server_name":{"exact":""}');
    expect(allow).toContain('"action":"ALLOW"');
    expect(allow).toContain('(?i)^([^.:]+\\\\.)*github\\\\.com$');
  });

  it('only records in monitor mode, allows anything when unrestricted, and denies everything offline', () => {
    const monitor = JSON.stringify(chains(filter('monitor')).tls);

    expect(monitor).not.toContain('"rules":{"action"');
    expect(monitor).toContain('"shadow_rules"');
    expect(JSON.stringify(chains(filter('enforce', { unrestricted: true, deny: [] })).tls)).toContain(
      '"permissions":[{"any":true}]',
    );
    expect(JSON.stringify(chains(filter('offline')).http[0])).toContain(
      '"action":"DENY","policies":{"r1_offline":{"permissions":[{"any":true}',
    );
  });

  it("names the deny policies after Agenstra's rules, in its precedence", () => {
    const deny = JSON.stringify(
      chains(
        filter('enforce', { denyCidrs: [{ cidr: '203.0.113.0/24', ports: [443], policy: 'shop/x', monitor: false }] }),
      ).tls[0],
    );

    expect(deny.indexOf('r2_deny_host')).toBeLessThan(deny.indexOf('r3_private_network'));
    expect(deny.indexOf('r3_private_network')).toBeLessThan(deny.indexOf('r4_ip_literal'));
    expect(deny).toContain('{"destination_ip":{"address_prefix":"203.0.113.0","prefix_len":24}}');
    // Agenstra's reserved ranges are blocked too.
    expect(deny).toContain('"address_prefix":"198.18.0.0","prefix_len":15');
  });

  it('applies per-source settings over the node level', () => {
    const own = chains(filter('enforce', { mode: 'monitor', blockIpLiterals: false })).tls;

    expect(JSON.stringify(own)).not.toContain('"rules"');
    expect(JSON.stringify(own)).not.toContain('r4_ip_literal');
    expect(JSON.stringify(chains(filter('monitor', { mode: 'offline' })).http[0])).toContain('r1_offline');
  });

  it('lifts the IP-literal block for explicitly allowed addresses', () => {
    expect(JSON.stringify(chains(filter('enforce', { allowCidrs: ['198.51.100.7/32'] })).tls[0])).toContain(
      '{"and_rules":{"rules":[{"or_rules":{"rules":[{"requested_server_name":{"exact":""}},{"requested_server_name":{"safe_regex":{"regex":"^(\\\\[?[0-9a-fA-F:.]*:[0-9a-fA-F:.]*\\\\]?|[0-9.]+)$"}}}]}},{"not_rule":{"or_rules":{"rules":[{"destination_ip":{"address_prefix":"198.51.100.7","prefix_len":32}}]}}}]}}',
    );
  });

  it('matches URL deny patterns on the whole plain-HTTP URL, never on TLS', () => {
    const regex = '(?i)(?s:.*)(?:\\/admin)(?s:.*)';
    const f = filter('enforce', { denyUrlRegexes: [regex] });
    const http = JSON.stringify(
      renderEgressListeners(f, ['10.42.1.1']).find((l) => (l as { name: string }).name.startsWith('egress_http')),
    );
    const tls = JSON.stringify(chains(f).tls);

    expect(http).toContain('envoy.filters.http.header_mutation');
    expect(http).toContain('"value":"http://%REQ(:AUTHORITY)%%REQ(:PATH)%"');
    expect(http).toContain('"request_headers_to_remove":["x-loadweaver-egress-url"]');
    expect(http).toContain('"r5_deny_url"');
    expect(tls).not.toContain('r5_deny_url');
    expect(http.indexOf('"name":"envoy.filters.http.header_mutation"')).toBeLessThan(
      http.indexOf('"name":"envoy.filters.http.rbac"'),
    );
  });

  it('logs how a decision was made', () => {
    const http = JSON.stringify(renderEgressListeners(filter('enforce', { mode: 'monitor' }), ['10.42.1.1']));

    expect(http).toContain('"mode":"monitor"');
    expect(http).toContain('%DYNAMIC_METADATA(envoy.filters.http.rbac:deny_shadow_effective_policy_id)%');
    expect(http).toContain('%RESPONSE_CODE_DETAILS%');
  });

  it('sends allowed names to the host itself and everything else to the original destination', () => {
    const listeners = renderEgressListeners(filter('enforce', { allowCidrs: ['10.1.0.0/16'] }), ['10.42.1.1']) as {
      name: string;
      filter_chains: { filter_chain_match: Record<string, unknown>; filters: object[] }[];
    }[];
    const tls = listeners.find((l) => l.name.startsWith('egress_tls'));
    const http = JSON.stringify(listeners.find((l) => l.name.startsWith('egress_http')));

    expect(tls?.filter_chains.map((c) => c.filter_chain_match['server_names'])).toEqual([
      ['*.github.com', 'github.com'],
      undefined,
    ]);
    expect(JSON.stringify(tls?.filter_chains[0])).toContain('"cluster":"egress_dfp_tls"');
    expect(JSON.stringify(tls?.filter_chains[1])).toContain('"cluster":"egress_original_dst"');
    // RBAC decides on the buffered ClientHello before any upstream connection is dialled.
    for (const chain of tls?.filter_chains ?? [])
      expect(JSON.stringify(chain)).toContain(
        '"max_early_data_bytes":65536,"upstream_connect_mode":"ON_DOWNSTREAM_DATA"',
      );
    expect(http).toContain('"domains":["*.github.com","github.com"]');
    expect(http).toContain('envoy.filters.http.dynamic_forward_proxy');
    // A CIDR allowed inside a private range lifts the block only for itself.
    expect(JSON.stringify(tls?.filter_chains[0])).toContain(
      '{"and_rules":{"rules":[{"destination_ip":{"address_prefix":"10.0.0.0","prefix_len":8}},{"not_rule":{"or_rules":{"rules":[{"destination_ip":{"address_prefix":"10.1.0.0","prefix_len":16}}]}}}]}}',
    );
    expect(JSON.stringify(renderEgressClusters(filter('enforce')))).toContain('envoy.clusters.dynamic_forward_proxy');
  });

  it('logs only denials without logAllowed, and records monitor allows as shadow rules', () => {
    const quiet = JSON.stringify(renderEgressListeners({ ...filter('enforce'), logAllowed: false }, ['10.42.1.1']));

    expect(quiet).toContain('"or_filter"');
    expect(quiet).toContain('allow_shadow_engine_result');
    expect(JSON.stringify(renderEgressListeners(filter('enforce'), ['10.42.1.1']))).not.toContain('"or_filter"');

    const trial = JSON.stringify(
      chains(
        filter('enforce', {
          unrestricted: true,
          allow: [{ host: 'pypi.org', ports: [443], policy: 'shop/trial', monitor: true }],
        }),
      ).tls,
    );

    expect(trial).toContain('"policies":{"monitored":{"permissions":[{"requested_server_name"');
    expect(trial).toContain('"permissions":[{"any":true}]');
  });

  it('redirects exactly the allowed web destinations and drops QUIC and DoT while filtering', () => {
    const script = renderNftables({ ...networkConfig(), egressFilter: filter('enforce') });

    expect(script).toContain(
      'ip saddr 10.42.1.10 ip daddr != { 10.42.0.0/16, 10.43.0.0/16 } ip daddr { 0.0.0.0/0 } tcp dport 443 counter redirect to :15444 comment "builtin:egress-filter"',
    );
    expect(script).toContain('tcp dport 80 counter redirect to :15080');
    expect(script).toContain('ip saddr 10.42.1.10 udp dport 443 counter drop comment "builtin:egress-quic"');
    expect(renderNftables({ ...networkConfig(), egressFilter: filter('monitor') })).not.toContain('egress-quic');
  });
});

describe('WorkloadIdentityManager', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lw-identities-'));

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('requests missing identities by CSR and keeps only certificates matching its keys', async () => {
    const sent: Envelope[] = [];
    const manager = new WorkloadIdentityManager({ dir } as never);
    const ca = await createCertificateAuthority({ commonName: 'test', validityDays: 1 });
    let changes = 0;

    manager.attach((e) => sent.push(e));
    manager.watch(() => changes++);
    await manager.ensure(['shop/shop/api']);

    const decoded = decodeAgentMessage(sent[0]);

    if (decoded.ok !== true || decoded.message.type !== 'workloadIdentityRequest') throw new Error('no request');

    const [request] = decoded.message.payload.requests;
    const sign = async (csrPem: string) =>
      (
        await issueCertificate({
          ca,
          csrPem,
          clusterId: 'c1',
          kind: 'workload',
          name: 'shop/shop/api',
          validityHours: 24,
        })
      ).certificatePem;
    // A certificate for someone else's key is ignored.
    const stranger = await sign(await createCsr(await generateKeyPair(), 'x'));

    await manager.deliver({
      certificates: [{ identity: request.identity, certificatePem: stranger }],
      refused: [],
      caCertificatePem: ca.certificatePem,
    });
    expect(await manager.held(['shop/shop/api'])).toEqual([]);

    await manager.deliver({
      certificates: [{ identity: request.identity, certificatePem: await sign(request.csrPem) }],
      refused: [],
      caCertificatePem: ca.certificatePem,
    });
    expect((await manager.held(['shop/shop/api'])).map((h) => h.identity)).toEqual(['shop/shop/api']);
    expect(await manager.ca()).toBe(ca.certificatePem);
    expect(changes).toBe(2);

    // Valid and fresh: nothing to request; no longer needed: removed.
    await manager.ensure(['shop/shop/api']);
    expect(sent).toHaveLength(1);
    await manager.ensure([]);
    expect(await manager.held(['shop/shop/api'])).toEqual([]);
  });
});
