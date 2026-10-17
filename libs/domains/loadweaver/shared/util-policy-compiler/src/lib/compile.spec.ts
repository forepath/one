import { clusterNetworkSchema, type PolicySpecInput, policySpecSchema } from '@forepath/loadweaver/shared/util-model';

import { compileNetwork, linkInterfaceName, selectRouteReflectors } from './compile';
import { diffCompilation } from './diff';
import type { CompilerClient, CompilerInput, CompilerNode, CompilerWorkload, NamedPolicy } from './types';

const network = clusterNetworkSchema.parse({
  podPoolV4: '10.42.0.0/16',
  servicePoolV4: '10.43.0.0/16',
  overlayPoolV4: '10.44.0.0/16',
});

function node(name: string, index: number, extra: Partial<CompilerNode> = {}): CompilerNode {
  return {
    name,
    site: 'fra1',
    labels: {},
    controlPlane: false,
    witness: false,
    overlayV4: `10.44.0.${index}`,
    podSubnetV4: `10.42.${index}.0/24`,
    endpointHost: `203.0.113.${index}`,
    wireguardPublicKey: `key-${name}`,
    ...extra,
  };
}

function workload(
  id: string,
  nodeName: string,
  nodeIndex: number,
  host: number,
  labels: Record<string, string>,
): CompilerWorkload {
  const [project, service] = id.split('/');

  return {
    id,
    project,
    deployment: project,
    service,
    node: nodeName,
    labels,
    addresses: [`10.42.${nodeIndex}.${host}`],
  };
}

function policy(name: string, spec: PolicySpecInput, project: string | undefined = 'shop'): NamedPolicy {
  return { name, project, spec: policySpecSchema.parse(spec) };
}

function baseInput(extra: Partial<CompilerInput> = {}): CompilerInput {
  return {
    network,
    nodes: [node('n1', 1), node('n2', 2), node('n3', 3)],
    workloads: [
      workload('shop/web/0', 'n1', 1, 10, { app: 'web' }),
      workload('shop/api/0', 'n2', 2, 10, { app: 'api' }),
      workload('shop/db/0', 'n3', 3, 10, { app: 'db' }),
    ],
    services: [
      { project: 'shop', deployment: 'shop', name: 'api', serviceIps: ['10.43.0.10'] },
      { project: 'shop', deployment: 'shop', name: 'db', serviceIps: ['10.43.0.11'] },
    ],
    nodeGroups: [],
    workloadGroups: ['web', 'api', 'db'].map((app) => ({
      project: 'shop',
      name: app,
      spec: { selector: { matchLabels: { app } }, intraGroup: 'allow' as const, exposed: false },
    })),
    // UDP: these tests are about the direct L3 / L4 path; TCP with ports goes through the node proxies (mesh tests).
    policies: [
      policy('web-to-api', {
        from: [{ group: 'web' }],
        to: [{ group: 'api' }],
        rules: [{ protocol: 'udp', ports: [8080] }],
      }),
      policy('api-to-db', {
        from: [{ group: 'api' }],
        to: [{ group: 'db' }],
        rules: [{ protocol: 'udp', ports: [5432] }],
      }),
    ],
    ...extra,
  };
}

describe('compileNetwork', () => {
  it('builds tunnels only between nodes whose workloads policies connect', () => {
    const result = compileNetwork(baseInput());

    expect(result.diagnostics).toEqual([]);
    expect(result.nodes['n1'].wireguard.map((l) => l.peer)).toEqual(['n2']);
    expect(result.nodes['n2'].wireguard.map((l) => l.peer)).toEqual(['n1', 'n3']);
    // Never transitive: web (n1) and db (n3) are both allowed to talk to api (n2) but not to each other.
    expect(result.nodes['n3'].wireguard.map((l) => l.peer)).toEqual(['n2']);
  });

  it('limits AllowedIPs to exactly the remote addresses involved plus the peer overlay address', () => {
    const result = compileNetwork(baseInput());
    const n1ToN2 = result.nodes['n1'].wireguard[0];

    expect(n1ToN2.allowedIps).toEqual(['10.42.2.10/32', '10.44.0.2/32']);
    expect(n1ToN2.interface).toBe(linkInterfaceName('n2'));
    expect(n1ToN2.interface.length).toBeLessThanOrEqual(15);
    expect(n1ToN2.peerEndpoint).toBe(`203.0.113.2:${result.portAllocations['n2']['n1']}`);
    expect(n1ToN2.reasons).toEqual(['shop/web-to-api']);
  });

  it('exports pod subnets only to peers that need them', () => {
    const result = compileNetwork(baseInput());
    const session = result.nodes['n2'].bgp.sessions.find((s) => s.peer === 'n1');

    expect(session?.exports).toEqual(['10.42.2.0/24', '10.44.0.2/32']);
    expect(session?.imports).toEqual(['10.42.1.0/24', '10.44.0.1/32']);
    expect(result.nodes['n1'].bgp.sessions.map((s) => s.peer)).toEqual(['n2']);
  });

  it('emits stateful allow rules on both ends of a flow', () => {
    const result = compileNetwork(baseInput());
    const n2 = result.nodes['n2'].firewall;
    const ingress = n2.rules.find((r) => r.policy === 'shop/web-to-api' && r.chain === 'forward');

    expect(ingress).toBeDefined();
    expect(n2.sets[ingress!.srcSet]).toEqual(['10.42.1.10/32']);
    expect(n2.sets[ingress!.dstSet]).toEqual(['10.42.2.10/32']);
    expect(ingress!.ports).toEqual(['8080']);
    expect(result.nodes['n1'].firewall.rules.some((r) => r.policy === 'shop/web-to-api')).toBe(true);
    expect(result.nodes['n3'].firewall.rules.some((r) => r.policy === 'shop/web-to-api')).toBe(false);
  });

  it('compiles monitor policies into observe rules', () => {
    const input = baseInput({
      policies: [
        policy('web-to-api', {
          mode: 'monitor',
          from: [{ group: 'web' }],
          to: [{ group: 'api' }],
          rules: [{ protocol: 'udp', ports: [8080] }],
        }),
      ],
    });
    const rule = compileNetwork(input).nodes['n2'].firewall.rules.find((r) => r.policy === 'shop/web-to-api');

    expect(rule?.action).toBe('observe');
  });

  it('answers DNS only for reachable services and NATs to reachable replicas', () => {
    const result = compileNetwork(baseInput());

    expect(result.nodes['n1'].dns.visibility['10.42.1.10']).toEqual(['api.shop.shop.lw']);
    expect(result.nodes['n1'].dns.records).toEqual([{ name: 'api.shop.shop.lw', addresses: ['10.43.0.10'] }]);
    expect(result.nodes['n1'].services).toEqual([
      { name: 'api.shop.shop.lw', serviceIp: '10.43.0.10', backends: ['10.42.2.10'] },
    ]);
    expect(result.nodes['n2'].dns.visibility['10.42.2.10']).toEqual(['db.shop.shop.lw']);
    expect(result.nodes['n3'].dns.records).toEqual([]);
  });

  it('adds built-in control-plane policies (agent → API, quorum traffic)', () => {
    const input = baseInput({
      nodes: [node('n1', 1, { controlPlane: true }), node('n2', 2), node('n3', 3)],
      workloads: [],
      policies: [],
    });
    const result = compileNetwork(input);

    expect(result.nodes['n2'].wireguard.map((l) => l.peer)).toEqual(['n1']);
    expect(
      result.nodes['n1'].firewall.rules.some(
        (r) => r.policy === 'builtin:agent-api' && r.chain === 'input' && r.ports[0] === '7443',
      ),
    ).toBe(true);
    expect(
      result.nodes['n1'].firewall.rules
        .filter((r) => r.policy === 'builtin:bgp')
        .map((r) => r.chain)
        .sort(),
    ).toEqual(['input', 'input', 'output', 'output']);
  });

  it('treats node groups with intraGroup allow as shared networking', () => {
    const input = baseInput({
      nodes: [node('n1', 1, { labels: { role: 'db' } }), node('n2', 2, { labels: { role: 'db' } }), node('n3', 3)],
      workloads: [],
      policies: [],
      nodeGroups: [{ name: 'db-hosts', spec: { selector: { matchLabels: { role: 'db' } }, intraGroup: 'allow' } }],
    });
    const result = compileNetwork(input);

    expect(result.nodes['n1'].wireguard.map((l) => l.peer)).toEqual(['n2']);
    expect(result.nodes['n3'].wireguard).toEqual([]);
  });

  it('reports unknown groups and unreachable NAT pairs', () => {
    const input = baseInput({
      nodes: [node('n1', 1, { endpointHost: undefined }), node('n2', 2, { endpointHost: undefined }), node('n3', 3)],
      policies: [
        ...baseInput().policies,
        policy('broken', { from: [{ group: 'nope', project: 'other' }], to: [{ group: 'db' }], rules: [{}] }),
      ],
    });
    const result = compileNetwork(input);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'error', message: 'unknown workload group other/nope' }),
        expect.objectContaining({ level: 'error', message: expect.stringContaining('n1 and n2 are both behind NAT') }),
      ]),
    );
    expect(result.nodes['n1'].wireguard[0].persistentKeepalive).toBe(25);
    expect(result.nodes['n1'].wireguard[0].peerEndpoint).toBeUndefined();
  });

  it('accepts external sources and ignores hostname / deny policies at L3/L4', () => {
    const input = baseInput({
      policies: [
        policy('expose', { from: [{ builtin: 'internet' }], to: [{ group: 'web' }], rules: [{ ports: [443] }] }),
        policy('egress', { from: [{ group: 'web' }], to: [{ host: 'api.example.com' }], rules: [{ ports: [443] }] }),
        policy('deny', {
          action: 'deny',
          from: [{ group: 'web' }],
          to: [{ group: 'api' }],
          rules: [{ http: { paths: ['/admin'] } }],
        }),
      ],
    });
    const result = compileNetwork(input);
    const rule = result.nodes['n1'].firewall.rules.find((r) => r.policy === 'shop/expose');

    expect(result.nodes['n1'].firewall.sets[rule!.srcSet]).toEqual(['0.0.0.0/0', '::/0']);
    expect(result.nodes['n1'].wireguard).toEqual([]);
    expect(result.flows.some((f) => f.policy === 'shop/egress' || f.policy === 'shop/deny')).toBe(false);
  });

  it('keeps WireGuard ports stable across compilations', () => {
    const first = compileNetwork(baseInput());
    const second = compileNetwork(baseInput({ portAllocations: { n2: { n3: 51820, n1: 51821 } } }));

    expect(first.portAllocations['n2']).toEqual({ n1: 51820, n3: 51821 });
    expect(second.portAllocations['n2']).toEqual({ n1: 51821, n3: 51820 });
  });

  it('supports IPv6-only nodes with a derived router id', () => {
    const v6 = (name: string, i: number): CompilerNode => ({
      ...node(name, i),
      overlayV4: undefined,
      podSubnetV4: undefined,
      overlayV6: `fd00:44::${i}`,
      podSubnetV6: `fd00:42:${i}::/80`,
      endpointHost: `2001:db8::${i}`,
    });
    const input = baseInput({
      nodes: [v6('n1', 1), v6('n2', 2)],
      workloads: [
        { ...workload('shop/web/0', 'n1', 1, 10, { app: 'web' }), addresses: ['fd00:42:1::10'] },
        { ...workload('shop/api/0', 'n2', 2, 10, { app: 'api' }), addresses: ['fd00:42:2::10'] },
      ],
    });
    const result = compileNetwork(input);

    expect(result.nodes['n1'].wireguard[0].allowedIps).toEqual(['fd00:42:2::10/128', 'fd00:44::2/128']);
    expect(result.nodes['n1'].wireguard[0].peerEndpoint).toMatch(/^\[2001:db8::2\]:\d+$/);
    expect(result.nodes['n1'].bgp.routerId).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  describe('scale (3.34)', () => {
    function bigCluster(count: number): CompilerInput {
      const nodes = Array.from({ length: count }, (_, i) =>
        node(`n${String(i + 1).padStart(2, '0')}`, i + 1, { site: i % 2 === 0 ? 'fra1' : 'ams1', controlPlane: i < 3 }),
      );

      return baseInput({ nodes, workloads: [], policies: [] });
    }

    it('keeps direct peering below the threshold', () => {
      expect(selectRouteReflectors(bigCluster(15))).toEqual([]);
    });

    it('designates two reflectors per site above the threshold, preferring control-plane nodes and current reflectors', () => {
      const input = bigCluster(20);

      expect(selectRouteReflectors(input)).toEqual(['n01', 'n02', 'n03', 'n04']);
      expect(selectRouteReflectors({ ...input, routeReflectors: ['n09', 'n10'] })).toEqual([
        'n01',
        'n02',
        'n09',
        'n10',
      ]);
    });

    it('routes built-in agent traffic through site hubs instead of N² tunnels', () => {
      const result = compileNetwork(bigCluster(40));
      const worker = result.nodes['n20'];

      // Workers only tunnel to their site's hubs.
      expect(worker.wireguard.map((l) => l.peer).every((p) => result.routeReflectors.includes(p))).toBe(true);
      expect(worker.bgp.sessions.every((s) => s.role === 'route-reflector')).toBe(true);
      const totalLinks = Object.values(result.nodes).reduce((sum, n) => sum + n.wireguard.length, 0) / 2;

      expect(totalLinks).toBeLessThan(40 * 4);
    });
  });

  it('describes changes per layer for the plan', () => {
    const before = compileNetwork(baseInput({ policies: [] }));
    const after = compileNetwork(baseInput());
    const changes = diffCompilation(before, after);

    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ layer: 'tunnels', action: 'add', summary: 'adds WireGuard peer n1↔n2' }),
        expect.objectContaining({
          layer: 'routing',
          action: 'add',
          summary: 'exports 10.42.2.0/24, 10.44.0.2/32 from n2 to n1',
        }),
        expect.objectContaining({ layer: 'dns', action: 'add', summary: 'api.shop.shop.lw becomes resolvable on n1' }),
      ]),
    );
    expect(diffCompilation(after, before).some((c) => c.summary === 'removes WireGuard peer n1↔n2')).toBe(true);
    expect(diffCompilation(after, after)).toEqual([]);
  });

  describe('egress from own prefixes', () => {
    const egressPolicy = (name: string, group: string) =>
      policy(name, {
        from: [{ group }],
        to: [{ builtin: 'internet' }],
        rules: [{ ports: [443] }],
        egress: { pools: ['egress'] },
      });

    it('routes the sources to the gateway over their link and source-NATs them there', () => {
      const result = compileNetwork(
        baseInput({
          policies: [...baseInput().policies, egressPolicy('web-out', 'web')],
          egress: [{ policy: 'shop/web-out', address: '198.51.100.7', holder: 'n3' }],
        }),
      );
      const n1 = result.nodes['n1'];
      const n3 = result.nodes['n3'];

      expect(result.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
      expect(n1.egress).toEqual({
        routes: [{ interface: linkInterfaceName('n3'), sources: ['10.42.1.10'], destinations: ['0.0.0.0/0'] }],
        snat: [],
      });
      expect(n1.wireguard.find((l) => l.peer === 'n3')?.allowedIps).toContain('0.0.0.0/0');
      // Only the address family with an egress address is routed through the gateway.
      expect(n1.wireguard.find((l) => l.peer === 'n3')?.allowedIps).not.toContain('::/0');
      expect(n3.wireguard.find((l) => l.peer === 'n1')?.allowedIps).toContain('10.42.1.10/32');
      expect(n3.egress).toEqual({ routes: [], snat: [{ address: '198.51.100.7', sources: ['10.42.1.10'] }] });
      // The gateway forwards the policy's traffic and routes answers back to the sources' pod subnet.
      expect(n3.firewall.rules.some((r) => r.policy === 'shop/web-out' && r.chain === 'forward')).toBe(true);
      expect(n1.bgp.sessions.find((s) => s.peer === 'n3')?.exports).toContain('10.42.1.0/24');
      expect(
        diffCompilation(compileNetwork(baseInput()), result)
          .filter((c) => c.layer === 'egress')
          .map((c) => c.summary),
      ).toEqual(['routes egress of 10.42.1.10 on n1 through n3', 'n3 sends 10.42.1.10 out as 198.51.100.7']);
    });

    it('sends only what the egress policy covers through the gateway', () => {
      const result = compileNetwork(
        baseInput({
          policies: [
            ...baseInput().policies,
            policy('partner', {
              from: [{ group: 'web' }],
              to: [{ cidr: '198.51.100.0/24' }],
              rules: [{ ports: [443] }],
              egress: { pools: ['egress'] },
            }),
            // Another policy lets the same workload reach the rest of the internet, without an egress address.
            policy('web-out', {
              from: [{ group: 'web' }],
              to: [{ builtin: 'internet' }],
              rules: [{ ports: [80, 443] }],
            }),
            policy('web-partner-ssh', {
              from: [{ group: 'web' }],
              to: [{ cidr: '198.51.100.0/25' }],
              rules: [{ ports: [22] }],
            }),
          ],
          egress: [{ policy: 'shop/partner', address: '203.0.113.50', holder: 'n3' }],
        }),
      );
      const n1 = result.nodes['n1'];
      const n3 = result.nodes['n3'];

      expect(n1.egress?.routes).toEqual([
        {
          interface: linkInterfaceName('n3'),
          sources: ['10.42.1.10'],
          destinations: ['198.51.100.0/24', '198.51.100.0/25'],
        },
      ]);
      expect(n1.wireguard.find((l) => l.peer === 'n3')?.allowedIps).not.toContain('0.0.0.0/0');
      // The internet in general stays direct; SSH into the partner range goes through the gateway, so it may pass.
      expect(
        result.flows.find((f) => f.policy === 'shop/web-out' && f.src.includes('10.42.1.10'))?.via,
      ).toBeUndefined();
      expect(n3.firewall.rules.some((r) => r.policy === 'shop/web-partner-ssh' && r.chain === 'forward')).toBe(true);
    });

    it('source-NATs local sources on the gateway without a route', () => {
      const result = compileNetwork(
        baseInput({
          policies: [...baseInput().policies, egressPolicy('api-out', 'api')],
          egress: [{ policy: 'shop/api-out', address: '198.51.100.8', holder: 'n2' }],
        }),
      );

      expect(result.nodes['n2'].egress).toEqual({
        routes: [],
        snat: [{ address: '198.51.100.8', sources: ['10.42.2.10'] }],
      });
      expect(result.nodes['n1'].egress).toBeUndefined();
    });

    it('refuses two egress addresses for one workload', () => {
      const result = compileNetwork(
        baseInput({
          policies: [...baseInput().policies, egressPolicy('a', 'web'), egressPolicy('b', 'web')],
          egress: [
            { policy: 'shop/a', address: '198.51.100.7', holder: 'n3' },
            { policy: 'shop/b', address: '198.51.100.9', holder: 'n3' },
          ],
        }),
      );

      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          level: 'error',
          message: '10.42.1.10 would leave with both 198.51.100.7 and 198.51.100.9; one egress address per workload',
        }),
      );
    });
  });

  describe('mesh (east-west through the node proxies)', () => {
    const meshInput = () =>
      baseInput({
        policies: [
          policy('web-to-api', {
            from: [{ group: 'web' }],
            to: [{ group: 'api' }],
            rules: [{ ports: [8080], http: { paths: ['/v1/'], methods: ['GET', 'POST'] } }],
          }),
          policy('no-admin', {
            action: 'deny',
            from: [{ group: 'web' }],
            to: [{ group: 'api' }],
            rules: [{ ports: [8080], http: { paths: ['/v1/admin'] } }],
          }),
        ],
      });

    it('sends allowed TCP service traffic through both nodes proxies instead of the direct path', () => {
      const result = compileNetwork(meshInput());
      const n1 = result.nodes['n1'];
      const n2 = result.nodes['n2'];

      expect(n1.mesh?.outbound).toEqual([
        {
          source: '10.42.1.10',
          identity: 'shop/shop/web',
          serviceIp: '10.43.0.10',
          port: 8080,
          upstream: 'shop/shop/api:8080',
        },
      ]);
      expect(n1.mesh?.upstreams).toEqual([
        {
          name: 'shop/shop/api:8080',
          sni: '8080.api.shop.shop.mesh.lw',
          identity: 'shop/shop/api',
          endpoints: ['10.44.0.2'],
        },
      ]);
      expect(n2.mesh?.inbound).toEqual([
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
              http: { paths: ['/v1/'], methods: ['GET', 'POST'] },
            },
            {
              identity: 'shop/shop/web',
              policy: 'shop/no-admin',
              mode: 'enforce',
              action: 'deny',
              http: { paths: ['/v1/admin'] },
            },
          ].sort((a, b) =>
            `${a.action}|${a.identity}|${a.policy}`.localeCompare(`${b.action}|${b.identity}|${b.policy}`),
          ),
        },
      ]);
      expect(n1.mesh?.identities).toEqual(['shop/shop/web']);
      expect(n2.mesh?.identities).toEqual(['shop/shop/api']);
      // No direct path between the replicas: only proxy to proxy over the overlay.
      expect(n2.firewall.rules.some((r) => r.policy === 'shop/web-to-api')).toBe(false);
      expect(n1.wireguard.find((l) => l.peer === 'n2')?.allowedIps).toEqual(['10.44.0.2/32']);
      expect(
        n2.firewall.rules.some((r) => r.policy === 'builtin:mesh' && r.chain === 'input' && r.ports[0] === '15443'),
      ).toBe(true);
      expect(
        n1.firewall.rules.some((r) => r.policy === 'builtin:mesh' && r.chain === 'input' && r.ports[0] === '15001'),
      ).toBe(true);
      expect(
        n2.firewall.rules.some((r) => r.policy === 'builtin:mesh' && r.chain === 'output' && r.ports[0] === '8080'),
      ).toBe(true);
      // The service stays resolvable for the client.
      expect(n1.dns.visibility['10.42.1.10']).toEqual(['api.shop.shop.lw']);
    });

    it('keeps UDP, wide port ranges and services without a service IP on the direct path', () => {
      const result = compileNetwork(
        baseInput({
          policies: [
            policy('wide', { from: [{ group: 'web' }], to: [{ group: 'api' }], rules: [{ ports: ['1000-2000'] }] }),
            policy('to-web', { from: [{ group: 'api' }], to: [{ group: 'web' }], rules: [{ ports: [80] }] }),
          ],
        }),
      );

      expect(result.nodes['n1'].mesh).toBeUndefined();
      expect(result.nodes['n2'].firewall.rules.some((r) => r.policy === 'shop/wide')).toBe(true);
      expect(result.nodes['n1'].firewall.rules.some((r) => r.policy === 'shop/to-web')).toBe(true);
    });
  });

  describe('egress filtering', () => {
    const settings = { mode: 'enforce' as const, blockPrivateNetworks: true, blockIpLiterals: false, logAllowed: true };
    const filterInput = (extra: Partial<CompilerInput> = {}) =>
      baseInput({
        policies: [
          policy('web-out', { from: [{ group: 'web' }], to: [{ builtin: 'internet' }], rules: [{ ports: [443] }] }),
          policy('github', { from: [{ group: 'web' }], to: [{ host: 'github.com' }], rules: [{ ports: [443] }] }),
          policy('no-gists', {
            action: 'deny',
            from: [{ group: 'web' }],
            to: [{ host: 'gist.github.com' }],
            rules: [{ ports: [443] }],
          }),
          policy('pypi', { from: [{ group: 'api' }], to: [{ host: '*.pypi.org' }], rules: [{ ports: [80, 443] }] }),
          policy('ssh', { from: [{ group: 'api' }], to: [{ host: 'example.com' }], rules: [{ ports: [22] }] }),
        ],
        egressFilter: settings,
        ...extra,
      });

    it('compiles allow / deny lists and reachability per local source', () => {
      const result = compileNetwork(filterInput());
      const web = result.nodes['n1'].egressFilter?.sources.find((s) => s.address === '10.42.1.10');
      const api = result.nodes['n2'].egressFilter?.sources.find((s) => s.address === '10.42.2.10');

      expect(result.nodes['n1'].egressFilter?.clusterRanges).toEqual(['10.42.0.0/16', '10.43.0.0/16', '10.44.0.0/16']);
      expect(web?.ports).toEqual([{ port: 443, destinations: ['0.0.0.0/0'] }]);
      expect(web?.allow.map((r) => r.host)).toEqual(['github.com']);
      expect(web?.deny.map((r) => r.host)).toEqual(['gist.github.com']);
      // An allow list restricts even an internet-wide L3 policy.
      expect(web?.unrestricted).toBe(false);
      // Hostname policies grant reachability on their web ports by themselves.
      expect(api?.ports).toEqual([
        { port: 80, destinations: ['0.0.0.0/0'] },
        { port: 443, destinations: ['0.0.0.0/0'] },
      ]);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ policy: 'shop/ssh', message: expect.stringContaining('only work for web traffic') }),
      );
      expect(result.nodes['n1'].firewall.rules.some((r) => r.policy === 'builtin:egress-filter')).toBe(true);
    });

    it('takes everything outside the cluster away when offline, and does nothing when off', () => {
      const offline = compileNetwork(filterInput({ egressFilter: { ...settings, mode: 'offline' } }));

      expect(offline.nodes['n1'].firewall.rules.some((r) => r.policy === 'shop/web-out')).toBe(false);
      expect(
        compileNetwork(filterInput({ egressFilter: { ...settings, mode: 'off' } })).nodes['n1'].egressFilter,
      ).toBeUndefined();
    });
  });

  describe('remote access', () => {
    const client = (id: string, address: string, groups: string[], extra: Partial<CompilerClient> = {}) => ({
      id,
      label: `alice@example.com/${id}`,
      publicKey: `pub-${id}`,
      address,
      subnets: [],
      groups,
      fullTunnel: false,
      ...extra,
    });
    const cluster = (name: string, spec: PolicySpecInput): NamedPolicy => ({
      ...policy(name, spec),
      project: undefined,
    });
    const remoteInput = (extra: Partial<CompilerInput> = {}) =>
      baseInput({
        policies: [
          ...baseInput().policies,
          policy('sales-to-api', { from: [{ clients: 'sales' }], to: [{ group: 'api' }], rules: [{ ports: [443] }] }),
          cluster('api-to-printers', {
            from: [{ selector: { matchLabels: { app: 'api' } } }],
            to: [{ clients: 'office' }],
            rules: [{ ports: [631] }],
          }),
        ],
        remoteAccess: {
          gateways: ['n1', 'n3'],
          active: 'n1',
          clientNetwork: '100.96.0.0/22',
          port: 51800,
          groups: ['sales', 'office', 'restricted'],
          clients: [
            client('laptop', '100.96.0.10', ['sales']),
            client('berlin', '100.96.0.20', ['office'], { subnets: ['192.168.10.0/24'], label: 'machine/berlin' }),
            client('kiosk', '100.96.0.30', ['restricted'], { fullTunnel: true }),
          ],
        },
        ...extra,
      });

    it('locates clients at the active gateway and routes their prefixes like its pod subnets', () => {
      const result = compileNetwork(remoteInput());
      const gateway = result.nodes['n1'];
      const standby = result.nodes['n3'];

      expect(gateway.remoteAccess).toMatchObject({
        active: true,
        listenPort: 51800,
        address: '100.96.0.1/22',
        prefixes: ['100.96.0.0/22', '192.168.10.0/24'],
      });
      expect(gateway.remoteAccess?.peers.map((p) => [p.id, p.allowedIps])).toEqual([
        ['berlin', ['100.96.0.20/32', '192.168.10.0/24']],
        ['kiosk', ['100.96.0.30/32']],
        ['laptop', ['100.96.0.10/32']],
      ]);
      // Standby gateways keep the peers but route nothing.
      expect(standby.remoteAccess).toMatchObject({ active: false, prefixes: [] });
      expect(standby.remoteAccess?.peers).toHaveLength(3);
      expect(result.nodes['n2'].remoteAccess).toBeUndefined();

      // The API node routes client answers back to the gateway, and the gateway exports the client prefixes.
      const link = result.nodes['n2'].wireguard.find((l) => l.peer === 'n1');

      expect(link?.allowedIps).toEqual(expect.arrayContaining(['100.96.0.10/32', '192.168.10.0/24']));
      expect(gateway.bgp.originate).toEqual(expect.arrayContaining(['100.96.0.0/22', '192.168.10.0/24']));
      expect(gateway.bgp.sessions.find((s) => s.peer === 'n2')?.exports).toEqual(
        expect.arrayContaining(['100.96.0.0/22']),
      );
      expect(result.nodes['n2'].bgp.sessions.find((s) => s.peer === 'n1')?.imports).toEqual(
        expect.arrayContaining(['100.96.0.0/22']),
      );
      // Filtering on both ends; DNS on the gateway for every client.
      expect(gateway.firewall.rules.some((r) => r.policy === 'shop/sales-to-api' && r.chain === 'forward')).toBe(true);
      expect(result.nodes['n2'].firewall.rules.some((r) => r.policy === 'shop/sales-to-api')).toBe(true);
      expect(gateway.firewall.rules.filter((r) => r.policy === 'builtin:vpn-dns').map((r) => r.protocol)).toEqual([
        'udp',
        'tcp',
      ]);
    });

    it('gives clients exactly the routes and names their policies allow', () => {
      const result = compileNetwork(remoteInput());

      expect(result.clients['laptop']).toEqual({
        address: '100.96.0.10/32',
        dns: '100.96.0.1',
        routes: ['10.42.2.10/32', '10.43.0.10/32', '100.96.0.1/32'],
        names: ['api.shop.shop.lw'],
      });
      // Offices: traffic from the policy's sources has to pass the router's AllowedIPs.
      expect(result.clients['berlin'].routes).toEqual(['10.42.2.10/32', '100.96.0.1/32']);
      expect(result.clients['berlin'].names).toEqual([]);
      expect(result.clients['kiosk'].routes).toEqual(['0.0.0.0/0', '::/0']);
      // The gateway resolves for the client and NATs the service IP.
      expect(result.nodes['n1'].dns.visibility['100.96.0.10']).toEqual(['api.shop.shop.lw']);
      expect(result.nodes['n1'].services.map((s) => s.serviceIp)).toContain('10.43.0.10');
    });

    it('reaches nothing without an active gateway, and rejects unsafe policies', () => {
      const idle = compileNetwork(remoteInput({ remoteAccess: { ...remoteInput().remoteAccess!, active: undefined } }));

      expect(idle.flows.some((f) => f.srcKind === 'client')).toBe(false);
      expect(idle.nodes['n1'].remoteAccess?.active).toBe(false);

      const result = compileNetwork(
        remoteInput({
          policies: [
            policy('project-to-office', {
              from: [{ group: 'api' }],
              to: [{ clients: 'office' }],
              rules: [{ ports: [22] }],
            }),
            policy('sales-http', {
              from: [{ clients: 'sales' }],
              to: [{ group: 'api' }],
              rules: [{ ports: [80], http: { paths: ['/public'] } }],
            }),
            policy('ghost', { from: [{ clients: 'nobody' }], to: [{ group: 'api' }], rules: [{ ports: [80] }] }),
          ],
        }),
      );

      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ level: 'error', policy: 'shop/project-to-office' }),
          expect.objectContaining({ level: 'warning', policy: 'shop/sales-http' }),
          expect.objectContaining({ level: 'error', message: 'unknown client group nobody' }),
        ]),
      );
      // HTTP matches can't be checked for clients: no flow at all instead of all of port 80.
      expect(result.flows.some((f) => f.policy === 'shop/sales-http')).toBe(false);
    });

    it('filters client web egress on the gateway', () => {
      const result = compileNetwork(
        remoteInput({
          policies: [
            cluster('kiosk-web', {
              from: [{ clients: 'restricted' }],
              to: [{ host: 'wiki.example.com' }],
              rules: [{ ports: [443] }],
            }),
          ],
          egressFilter: { mode: 'enforce', blockPrivateNetworks: true, blockIpLiterals: false, logAllowed: false },
        }),
      );
      const kiosk = result.nodes['n1'].egressFilter?.sources.find((s) => s.address === '100.96.0.30');

      expect(kiosk?.allow.map((r) => r.host)).toEqual(['wiki.example.com']);
      const rule = result.nodes['n1'].firewall.rules.find((r) => r.policy === 'builtin:egress-filter');

      expect(result.nodes['n1'].firewall.sets[rule!.dstSet]).toContain('100.96.0.1/32');
    });

    it('shows gateway role changes in the plan', () => {
      const before = compileNetwork(baseInput());
      const after = compileNetwork(remoteInput());

      expect(diffCompilation(before, after).filter((c) => c.layer === 'remote-access')).toEqual([
        expect.objectContaining({ node: 'n1', action: 'add', summary: 'n1 becomes the active remote access gateway' }),
        expect.objectContaining({ node: 'n3', action: 'add', summary: 'n3 becomes the standby remote access gateway' }),
      ]);
    });
  });

  describe('fail-closed L7 and hostname rules', () => {
    it('drops http rules the mesh cannot carry instead of allowing them at L4', () => {
      const result = compileNetwork(
        baseInput({
          policies: [
            policy('web-to-api-paths', {
              from: [{ group: 'web' }],
              to: [{ group: 'api' }],
              rules: [{ protocol: 'tcp', http: { paths: ['/public'] } }],
            }),
            policy('web-to-api-meshed', {
              from: [{ group: 'web' }],
              to: [{ group: 'api' }],
              rules: [{ ports: [8080], http: { paths: ['/public'] } }],
            }),
          ],
        }),
      );

      // No ports: not carried by the proxies, so not allowed at all (and said so).
      expect(result.flows.some((f) => f.policy === 'shop/web-to-api-paths')).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ policy: 'shop/web-to-api-paths', message: expect.stringContaining('http matches') }),
      );
      // Explicit ports to a service with a service IP: through the proxies, where the match is checked.
      expect(result.nodes['n2'].mesh?.inbound.some((i) => i.http)).toBe(true);
      expect(result.diagnostics.some((d) => d.policy === 'shop/web-to-api-meshed')).toBe(false);
    });

    it('treats monitor hostname allows as records only', () => {
      const settings = {
        mode: 'enforce' as const,
        blockPrivateNetworks: true,
        blockIpLiterals: false,
        logAllowed: true,
      };
      const result = compileNetwork(
        baseInput({
          policies: [
            policy('web-out', { from: [{ group: 'web' }], to: [{ builtin: 'internet' }], rules: [{ ports: [443] }] }),
            policy('trial', {
              mode: 'monitor',
              from: [{ group: 'web' }],
              to: [{ host: 'github.com' }],
              rules: [{ ports: [443] }],
            }),
            policy('api-trial', {
              mode: 'monitor',
              from: [{ group: 'api' }],
              to: [{ host: 'pypi.org' }],
              rules: [{ ports: [443] }],
            }),
          ],
          egressFilter: settings,
        }),
      );
      const web = result.nodes['n1'].egressFilter?.sources.find((s) => s.address === '10.42.1.10');

      // Still unrestricted (the monitor allow doesn't take the internet policy away) ...
      expect(web?.unrestricted).toBe(true);
      expect(web?.allow).toEqual([expect.objectContaining({ host: 'github.com', monitor: true })]);
      // ... and opens nothing by itself.
      expect(result.nodes['n2'].egressFilter).toBeUndefined();
    });
  });
});
