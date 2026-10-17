import { desiredPtrRecords, reverseName } from '../dns/dns-desired.utils';
import { egressClaims, egressGateways, egressPolicyOf, poolWarnings } from './public-ipam.utils';

describe('egress addresses and reverse DNS', () => {
  it('claims one address per pool of an egress policy and hands the gateways to the compiler', () => {
    const claims = egressClaims([
      { project: 'shop', name: 'out', spec: { egress: { pools: ['v4', 'v6'] } } },
      { project: null, name: 'plain', spec: {} },
    ]);

    expect(claims).toEqual([
      { owner: 'egress/shop/out/0', pool: 'v4', purpose: 'egress' },
      { owner: 'egress/shop/out/1', pool: 'v6', purpose: 'egress' },
    ]);
    expect(egressPolicyOf('egress/shop/out/1')).toBe('shop/out');
    expect(egressPolicyOf('ingress/0')).toBeNull();
    expect(
      egressGateways([
        { address: '198.51.100.7', owner: 'egress/shop/out/0', state: 'assigned', holder: 'n3' },
        { address: '198.51.100.8', owner: 'egress/shop/out/1', state: 'assigned', holder: null },
        { address: '198.51.100.9', owner: 'ingress/0', state: 'assigned', holder: 'n1' },
        { address: '198.51.100.10', owner: null, state: 'cooldown', holder: null },
      ]),
    ).toEqual([{ policy: 'shop/out', address: '198.51.100.7', holder: 'n3' }]);
  });

  it('names reverse records and places them in the managed reverse zone', () => {
    expect(reverseName('203.0.113.10')).toBe('10.113.0.203.in-addr.arpa');
    expect(reverseName('::ffff:192.0.2.1')).toBe(
      '1.0.2.0.0.0.0.c.f.f.f.f.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.ip6.arpa',
    );
    expect(reverseName('2001:db8::1')).toBe('1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa');

    const zones = new Map([
      ['rev4', { zone: '113.0.203.in-addr.arpa', provider: 'ns', secondaries: [], dnssec: false, defaultTtl: 3600 }],
    ]);
    const result = desiredPtrRecords(zones, [
      { address: '203.0.113.10', host: 'out.example.com', source: 'Policy shop/out' },
      { address: '198.51.100.7', host: 'out.example.com', source: 'Policy shop/out' },
    ]);

    expect(result.records).toEqual([
      {
        zone: 'rev4',
        fqdn: '10.113.0.203.in-addr.arpa',
        type: 'PTR',
        values: ['out.example.com'],
        ttl: 3600,
        source: 'Policy shop/out',
      },
    ]);
    expect(result.warnings).toEqual([
      'PTR 198.51.100.7 → out.example.com: no managed reverse zone covers it; set it where the address is delegated',
    ]);
  });

  it('calls addresses a single node holds, or that cannot move, pins', () => {
    const node = (name: string) => ({ name, site: 'fra1', labels: {}, lifecycle: 'active', reachable: false });
    const pool = (failover: 'vrrp' | 'none') => ({
      cidrs: ['192.0.2.0/29'],
      nodeGroup: 'edge',
      failover,
      bgpMode: 'primary-backup' as const,
      purposes: ['egress' as const],
      cooldownSeconds: 0,
    });
    const rows = [{ pool: 'p', owner: 'egress/shop/out/0', state: 'assigned' as const }];
    const groups = (names: string[]) => new Map([['edge', { selector: { names }, intraGroup: 'allow' as const }]]);

    expect(poolWarnings(new Map([['p', pool('vrrp')]]), groups(['n1', 'n2']), [node('n1'), node('n2')], rows)).toEqual(
      [],
    );
    expect(poolWarnings(new Map([['p', pool('vrrp')]]), groups(['n1']), [node('n1'), node('n2')], rows)).toEqual([
      'IpPool p: only n1 can hold its addresses; a failure takes egress/shop/out/0 offline',
    ]);
    expect(poolWarnings(new Map([['p', pool('none')]]), groups(['n1', 'n2']), [node('n1')], rows)).toEqual([
      "IpPool p: addresses can't move between nodes; egress/shop/out/0 are pinned to their holder",
    ]);
  });
});
