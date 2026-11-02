import type { IpPoolSpec } from '@forepath/loadweaver/shared/util-model';

import { chooseHolder, clusterClaims, holderCandidates, planPublicAddresses } from './public-ipam.utils';

const pool = (extra: Partial<IpPoolSpec> = {}): IpPoolSpec => ({
  cidrs: ['203.0.113.0/29'],
  nodeGroup: 'ingress',
  failover: 'vrrp',
  purposes: ['ingress', 'port-forward', 'egress', 'dns'],
  bgpMode: 'primary-backup',
  cooldownSeconds: 3600,
  ...extra,
});
const T0 = new Date('2026-07-01T00:00:00Z');

describe('public IPAM', () => {
  it('assigns stable addresses, skipping the network address of on-link prefixes, with unique VRRP ids', () => {
    const pools = new Map([['pub', pool()]]);
    const first = planPublicAddresses(pools, [], clusterClaims({ pool: 'pub', addresses: 2 }), T0);

    expect(first.errors).toEqual([]);
    expect(first.rows.map((r) => [r.owner, r.address, r.vrid])).toEqual([
      ['ingress/0', '203.0.113.1', 1],
      ['ingress/1', '203.0.113.2', 2],
    ]);
    expect(planPublicAddresses(pools, first.rows, clusterClaims({ pool: 'pub', addresses: 2 }), T0).rows).toEqual(
      first.rows,
    );
  });

  it('puts released addresses into a cooldown before reuse', () => {
    const pools = new Map([['pub', pool({ cidrs: ['203.0.113.10/32', '203.0.113.11/32'], failover: 'bgp' })]]);
    const two = planPublicAddresses(pools, [], clusterClaims({ pool: 'pub', addresses: 2 }), T0).rows;
    const one = planPublicAddresses(pools, two, clusterClaims({ pool: 'pub', addresses: 1 }), T0).rows;

    expect(one.find((r) => r.address === '203.0.113.11')).toMatchObject({ state: 'cooldown', owner: null });
    // Another claim can't take the cooling address yet.
    expect(
      planPublicAddresses(
        pools,
        one,
        [...clusterClaims({ pool: 'pub', addresses: 1 }), { owner: 'x', pool: 'pub', purpose: 'egress' }],
        T0,
      ).errors,
    ).toEqual(['x: IP pool pub is exhausted']);

    const later = planPublicAddresses(
      pools,
      one,
      clusterClaims({ pool: 'pub', addresses: 1 }),
      new Date(T0.getTime() + 3_600_000),
    );

    expect(later.removed).toEqual(['203.0.113.11']);
  });

  it('rejects missing pools and wrong purposes', () => {
    const pools = new Map([['dns-only', pool({ purposes: ['dns'] })]]);

    expect(
      planPublicAddresses(
        pools,
        [],
        [
          { owner: 'ingress/0', pool: 'dns-only', purpose: 'ingress' },
          { owner: 'y', pool: 'nope', purpose: 'dns' },
        ],
        T0,
      ).errors,
    ).toEqual(['ingress/0: IP pool dns-only is not for ingress', 'y: IP pool nope does not exist']);
  });

  it('keeps a healthy holder and otherwise takes the first candidate of the node group', () => {
    const nodes = [
      { name: 'n2', site: 'fra1', labels: { role: 'ingress' }, lifecycle: 'active', reachable: true },
      { name: 'n1', site: 'fra1', labels: { role: 'ingress' }, lifecycle: 'active', reachable: false },
      { name: 'n3', site: 'fra1', labels: { role: 'ingress' }, lifecycle: 'draining', reachable: true },
      { name: 'n4', site: 'fra1', labels: { role: 'web' }, lifecycle: 'active', reachable: true },
    ];
    const candidates = holderCandidates({ selector: { matchLabels: { role: 'ingress' } }, intraGroup: 'allow' }, nodes);

    expect(candidates).toEqual(['n2']);
    expect(chooseHolder('n1', candidates)).toBe('n2');
    expect(chooseHolder('n2', ['n0', 'n2'])).toBe('n2');
    expect(chooseHolder(null, [])).toBeNull();
  });
});
