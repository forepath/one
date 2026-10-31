import type { CompilerInput } from '@forepath/loadweaver/shared/util-policy-compiler';

import { buildTopology, flowEdges, planOverlay, scopeTopology, type TopologyExtras } from './topology.utils';

const input = {
  network: {},
  nodes: [
    { name: 'n1', site: 'a', labels: {}, controlPlane: true, witness: false, wireguardPublicKey: 'k1', ingress: true },
    { name: 'n2', site: 'b', labels: {}, controlPlane: false, witness: false, wireguardPublicKey: 'k2' },
  ],
  workloads: [
    {
      id: 'shop/site/web/0',
      project: 'shop',
      deployment: 'site',
      service: 'web',
      node: 'n1',
      labels: { tier: 'web' },
      addresses: ['10.1.0.2/32'],
    },
    {
      id: 'shop/site/db/0',
      project: 'shop',
      deployment: 'site',
      service: 'db',
      node: 'n2',
      labels: {},
      addresses: ['10.1.0.3/32'],
    },
    {
      id: 'blog/app/web/0',
      project: 'blog',
      deployment: 'app',
      service: 'web',
      node: 'n2',
      labels: {},
      addresses: ['10.1.0.4/32'],
    },
  ],
  services: [],
  nodeGroups: [],
  workloadGroups: [
    { project: 'shop', name: 'frontend', spec: { selector: { matchLabels: { tier: 'web' } } } },
    { project: 'shop', name: 'expose:web', spec: { selector: { matchLabels: {} } } },
  ],
  policies: [
    {
      project: 'shop',
      name: 'to-db',
      spec: { mode: 'enforce', action: 'allow', from: [{ group: 'frontend' }], to: [{ cidr: '0.0.0.0/0' }], rules: [] },
    },
  ],
} as unknown as CompilerInput;

const extras: TopologyExtras = {
  health: new Map([['node/n1', 'healthy']]),
  tunnels: new Map([
    ['n1', ['n2']],
    ['n2', ['n1']],
  ]),
  volumes: [{ id: 'shop/site/data', primaryNode: 'n2', syncReplicas: ['n1'], remoteReplicas: [], crossSite: 'sync' }],
  addresses: [{ address: '203.0.113.1', holder: 'n1', owner: 'ingress' }],
  hostnames: [{ host: 'shop.example.com', services: ['shop/site/web'] }],
  replicaStates: new Map([['shop/site/web/0', 'running']]),
};

describe('topology utils', () => {
  const graph = buildTopology(input, extras);
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it('marks draining replicas as draining instead of their reported state (M6 gate)', () => {
    const drained = buildTopology(
      {
        ...input,
        workloads: input.workloads.map((w) => (w.id === 'shop/site/web/0' ? { ...w, draining: true } : w)),
      },
      extras,
    );

    expect(drained.elements.find((e) => e.id === 'replica:shop/site/web/0')?.data).toMatchObject({
      state: 'draining',
      draining: true,
    });
    expect(graph.elements.find((e) => e.id === 'replica:shop/site/web/0')?.data['draining']).toBeUndefined();
  });

  it('builds sites, nodes, replicas, groups and their edges', () => {
    expect(ids(graph.elements)).toEqual(
      expect.arrayContaining(['site:a', 'site:b', 'node:n1', 'replica:shop/site/web/0', 'group:shop/frontend']),
    );
    expect(ids(graph.elements)).not.toContain('group:shop/expose:web');
    expect(graph.elements.find((e) => e.id === 'replica:shop/site/web/0')).toMatchObject({
      parent: 'node:n1',
      data: { state: 'running' },
    });
    expect(graph.elements.find((e) => e.id === 'node:n1')?.data['health']).toBe('healthy');
    expect(ids(graph.edges)).toEqual(
      expect.arrayContaining([
        'member:shop/frontend:shop/site/web/0',
        'policy:shop/to-db:group:shop/frontend->external:0.0.0.0/0',
        'tunnel:n1|n2',
        'volume:shop/site/data:n2',
        'exposure:shop.example.com:shop/site/web/0',
        'address:203.0.113.1:n1',
      ]),
    );
    expect(graph.edges.filter((e) => e.kind === 'tunnel')).toHaveLength(1);
  });

  it('scopes to the caller', () => {
    expect(scopeTopology(graph, true, new Set())).toBe(graph);

    const scoped = scopeTopology(graph, false, new Set(['shop']));
    const scopedIds = ids(scoped.elements);

    expect(scopedIds).toEqual(expect.arrayContaining(['replica:shop/site/web/0', 'hostname:shop.example.com']));
    expect(scopedIds.some((id) => id.startsWith('node:') || id.startsWith('site:') || id.startsWith('address:'))).toBe(
      false,
    );
    expect(scopedIds).not.toContain('replica:blog/app/web/0');
    expect(scoped.elements.find((e) => e.id === 'replica:shop/site/web/0')?.parent).toBeUndefined();
    expect(scoped.edges.some((e) => e.kind === 'tunnel' || e.kind === 'volume')).toBe(false);
    expect(ids(scopeTopology(graph, false, new Set(['blog'])).elements)).not.toContain('hostname:shop.example.com');
  });

  it('resolves flows per node and splits set-sided counts', () => {
    const { edges, externals } = flowEdges(
      [
        {
          node: 'n1',
          policy: 'shop/to-db',
          src: 'web',
          dst: '10.1.0.3',
          protocol: 'tcp',
          port: 5432,
          decision: 'allow',
          packets: 2,
          bytes: 120,
        },
        {
          node: 'n1',
          policy: 'shop/to-db',
          src: '10.1.0.2',
          dst: '10.1.0.3',
          protocol: 'tcp',
          port: 5432,
          decision: 'allow',
          packets: 3,
          bytes: 180,
        },
        // The same set name on n2 has two members: the counts are spread, not copied.
        {
          node: 'n2',
          policy: '',
          src: 'web',
          dst: '198.51.100.7',
          protocol: 'udp',
          port: 53,
          decision: 'deny',
          packets: 4,
          bytes: 240,
        },
        {
          node: 'n2',
          policy: '',
          src: '100.64.0.1',
          dst: '10.1.0.3',
          protocol: 'tcp',
          port: 22,
          decision: 'deny',
          packets: 1,
          bytes: 60,
        },
      ],
      new Map([
        ['n1', new Map([['web', ['10.1.0.2/32']]])],
        ['n2', new Map([['web', ['10.1.0.2/32', '10.1.0.4/32']]])],
      ]),
      new Map([
        ['10.1.0.2', 'replica:shop/site/web/0'],
        ['10.1.0.3', 'replica:shop/site/db/0'],
        ['10.1.0.4', 'replica:blog/app/web/0'],
        ['100.64.0.1', 'node:n1'],
      ]),
      60,
    );

    expect(edges[0]).toMatchObject({
      source: 'replica:shop/site/web/0',
      target: 'replica:shop/site/db/0',
      data: { packets: 5, bytes: 300, bytesPerSecond: 5, estimated: false },
    });
    expect(edges.filter((e) => e.data['decision'] === 'deny' && e.data['port'] === 53)).toEqual([
      expect.objectContaining({
        source: 'replica:shop/site/web/0',
        data: expect.objectContaining({ packets: 2, estimated: true, policy: null }),
      }),
      expect.objectContaining({ source: 'replica:blog/app/web/0', data: expect.objectContaining({ packets: 2 }) }),
    ]);
    expect(edges.find((e) => e.data['port'] === 22)?.source).toBe('node:n1');
    expect(externals.map((e) => e.id)).toEqual(['external:198.51.100.7']);
  });

  it('draws every kind of policy peer', () => {
    const peers = buildTopology(
      {
        ...input,
        policies: [
          {
            project: 'shop',
            name: 'out',
            spec: {
              mode: 'enforce',
              action: 'allow',
              from: [{ selector: { matchLabels: { tier: 'web' } } }],
              to: [{ host: 'api.example.com' }, { site: 'b' }, { builtin: 'internet' }, { clients: 'staff' }],
              rules: [],
            },
          },
        ],
      } as unknown as CompilerInput,
      extras,
    );
    const policyEdges = peers.edges.filter((e) => e.kind === 'policy');
    const selector = peers.elements.find((e) => e.kind === 'group' && e.data['selector']);

    expect(selector).toMatchObject({ project: 'shop' });
    expect(peers.edges).toContainEqual(
      expect.objectContaining({ kind: 'member', source: selector?.id, target: 'replica:shop/site/web/0' }),
    );
    expect(policyEdges.map((e) => e.target).sort()).toEqual([
      'external:builtin:internet',
      'external:clients:staff',
      'external:host:api.example.com',
      'site:b',
    ]);
    // Members don't see the site edge.
    expect(scopeTopology(peers, false, new Set(['shop'])).edges.some((e) => e.target === 'site:b')).toBe(false);
  });

  it('overlays a plan', () => {
    expect(
      planOverlay(graph, [
        { action: 'update', kind: 'Policy', name: 'to-db', project: 'shop' },
        { action: 'delete', kind: 'Deployment', name: 'site', project: 'shop' },
        { action: 'create', kind: 'WorkloadGroup', name: 'backend', project: 'shop' },
        { action: 'noop', kind: 'Node', name: 'n1', project: null },
      ]),
    ).toEqual({
      'policy:shop/to-db:group:shop/frontend->external:0.0.0.0/0': 'update',
      'replica:shop/site/web/0': 'delete',
      'replica:shop/site/db/0': 'delete',
      'volume:shop/site/data': 'delete',
      'group:shop/backend': 'create',
    });
  });

  it('overlays virtual machines, their disks, DNS records and sites (3.36 B1)', () => {
    const withVm = buildTopology(
      {
        ...input,
        workloads: [
          ...input.workloads,
          {
            id: 'shop/lw-vm/db1/0',
            project: 'shop',
            deployment: 'lw-vm',
            service: 'db1',
            node: 'n1',
            labels: {},
            addresses: ['10.1.0.9/32'],
          },
        ],
      } as CompilerInput,
      {
        ...extras,
        volumes: [
          ...extras.volumes,
          { id: 'shop/lw-vm/db1.root', primaryNode: 'n1', syncReplicas: [], remoteReplicas: [], crossSite: 'none' },
        ],
      },
    );

    expect(
      planOverlay(
        withVm,
        [
          { action: 'update', kind: 'VirtualMachine', name: 'db1', project: 'shop' },
          { action: 'create', kind: 'DnsRecord', name: 'shop', project: null, spec: { zone: 'ex', name: 'shop' } },
          { action: 'delete', kind: 'DnsRecord', name: 'apex', project: null, spec: { zone: 'ex', name: '@' } },
          { action: 'create', kind: 'DnsRecord', name: 'x', project: null, spec: { zone: 'unknown', name: 'x' } },
          { action: 'update', kind: 'Site', name: 'a', project: null },
        ],
        { dnsZones: new Map([['ex', 'Example.com.']]) },
      ),
    ).toEqual({
      'replica:shop/lw-vm/db1/0': 'update',
      'volume:shop/lw-vm/db1.root': 'update',
      'hostname:shop.example.com': 'create',
      'hostname:example.com': 'delete',
      'site:a': 'update',
    });
  });
});
