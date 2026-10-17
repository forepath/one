import type { IpPoolSpec, NodeGroupSpec } from '@forepath/loadweaver/shared/util-model';

import { bgpResources, bgpWarnings, healthyReplicas, nodeExternalBgp, validateBgp } from './bgp-state.utils';

const res = (kind: string, name: string, spec: unknown) => ({ kind, name, spec }) as never;
const groups = new Map<string, NodeGroupSpec>([
  ['edge', { selector: { matchLabels: { role: 'edge' } }, intraGroup: 'allow' }],
]);
const node = (name: string, site: string, lifecycle = 'active') => ({
  name,
  site,
  labels: { role: 'edge' },
  lifecycle,
});
const pools = new Map<string, IpPoolSpec>([
  [
    'vip',
    {
      cidrs: ['198.51.100.0/28'],
      nodeGroup: 'edge',
      failover: 'bgp',
      purposes: ['ingress'],
      bgpMode: 'primary-backup',
      cooldownSeconds: 0,
    },
  ],
]);

describe('external BGP state', () => {
  const resources = [
    res('AutonomousSystem', 'own', { asn: 4200000001, prefixes: ['203.0.113.0/24'] }),
    res('BgpPeer', 'transit', { asn: 64500, address: '192.0.2.1', nodeGroup: 'edge' }),
    res('BgpAnnouncement', 'web', {
      prefixes: ['203.0.113.0/24'],
      nodeGroup: 'edge',
      mode: 'primary-backup',
      primarySite: 'fra1',
      communities: ['64500:100'],
    }),
  ];
  const bgp = bgpResources(resources);

  it('announces only held prefixes', () => {
    expect(validateBgp(bgp, pools)).toEqual([]);
    expect(
      validateBgp(
        bgpResources([
          ...resources,
          res('BgpAnnouncement', 'evil', { prefixes: ['8.8.8.0/24'], nodeGroup: 'edge', peers: ['nope'] }),
        ]),
        pools,
      ),
    ).toEqual([
      'BgpAnnouncement evil: 8.8.8.0/24 is not held by the cluster (AutonomousSystem prefixes or IP pools)',
      'BgpAnnouncement evil: peer nope does not exist',
    ]);
    expect(validateBgp(bgpResources([resources[1]]), pools)).toEqual([
      'BGP peers and announcements need an AutonomousSystem',
    ]);
  });

  it('builds per-node sessions: primary site plain, backup site prepended, failover addresses by holder, shutdown while draining', () => {
    const addresses = [{ address: '198.51.100.1', holder: 'fra-a', candidates: ['fra-a', 'ams-a'] }];
    const primary = nodeExternalBgp(node('fra-a', 'fra1'), bgp, groups, addresses);
    const backup = nodeExternalBgp(node('ams-a', 'ams1', 'draining'), bgp, groups, addresses);

    expect(primary?.announcements).toEqual([
      { prefix: '198.51.100.1/32', peers: ['transit'], communities: [], prepend: 0 },
      { prefix: '203.0.113.0/24', peers: ['transit'], communities: ['64500:100'], prepend: 0 },
    ]);
    expect(backup?.announcements.map((a) => a.prepend)).toEqual([3, 3]);
    expect(backup?.gracefulShutdown).toBe(true);
    expect(primary?.peers).toEqual([
      { name: 'transit', address: '192.0.2.1', asn: 64500, bfd: true, import: 'default', maxPrefixes: 10 },
    ]);
    expect(
      nodeExternalBgp({ name: 'x', site: 'fra1', labels: {}, lifecycle: 'active' }, bgp, groups, addresses),
    ).toBeUndefined();
  });

  it('announces only while the backing service is healthy in the chosen scope', () => {
    const gated = (scope: string) =>
      bgpResources([
        resources[0],
        resources[1],
        res('BgpAnnouncement', 'anycast', {
          prefixes: ['203.0.113.0/24'],
          nodeGroup: 'edge',
          whenHealthy: { service: 'shop/web/api', scope },
        }),
      ]);
    const up = healthyReplicas(
      [
        {
          project: 'shop',
          deployment: 'web',
          service: 'api',
          node: 'fra-b',
          status: { 'fra-b': { state: 'healthy' } },
        },
        {
          project: 'shop',
          deployment: 'web',
          service: 'api',
          node: 'ams-a',
          status: { 'ams-a': { state: 'unhealthy' } },
        },
        { project: 'shop', deployment: 'web', service: 'api', node: 'nyc-a', status: null },
      ],
      new Map([
        ['fra-b', 'fra1'],
        ['ams-a', 'ams1'],
      ]),
      new Set(['fra-b', 'ams-a', 'nyc-a']),
    );
    const announced = (scope: string, n: ReturnType<typeof node>) =>
      (nodeExternalBgp(n, gated(scope), groups, [], up)?.announcements ?? []).map((a) => a.prefix);

    expect(up).toEqual([{ service: 'shop/web/api', node: 'fra-b', site: 'fra1' }]);
    expect(announced('site', node('fra-a', 'fra1'))).toEqual(['203.0.113.0/24']);
    // ams has no healthy replica: withdrawn there, so traffic goes to fra.
    expect(announced('site', node('ams-a', 'ams1'))).toEqual([]);
    expect(announced('node', node('fra-a', 'fra1'))).toEqual([]);
    expect(announced('cluster', node('ams-a', 'ams1'))).toEqual(['203.0.113.0/24']);
    // fra-b stopped reporting: its last "healthy" no longer counts.
    expect(
      healthyReplicas(
        [
          {
            project: 'shop',
            deployment: 'web',
            service: 'api',
            node: 'fra-b',
            status: { 'fra-b': { state: 'healthy' } },
          },
        ],
        new Map([['fra-b', 'fra1']]),
        new Set(),
      ),
    ).toEqual([]);
  });

  it('warns about single announcing nodes, anycast with L4 and BGP pools without peers', () => {
    expect(bgpWarnings(bgp, pools, groups, [node('fra-a', 'fra1')], false)).toEqual([
      'BgpAnnouncement web: announced from a single node (fra-a); a failure takes the prefixes offline',
    ]);
    expect(bgpWarnings(bgpResources([resources[0]]), pools, groups, [node('fra-a', 'fra1')], false)).toEqual([
      'IpPool vip: BGP failover, but no node of edge has a BGP peer',
    ]);
  });
});

describe('anycast addresses', () => {
  it('are announced equally by every holder', () => {
    const bgp = bgpResources([
      res('AutonomousSystem', 'own', { asn: 4200000001 }),
      res('BgpPeer', 'transit', { asn: 64500, address: '192.0.2.1', nodeGroup: 'edge' }),
    ]);
    const anycast = [{ address: '198.51.100.53', holder: 'fra-a', candidates: ['fra-a', 'ams-a'], anycast: true }];

    expect(nodeExternalBgp(node('ams-a', 'ams1'), bgp, groups, anycast)?.announcements).toEqual([
      { prefix: '198.51.100.53/32', peers: ['transit'], communities: [], prepend: 0 },
    ]);
  });
});
