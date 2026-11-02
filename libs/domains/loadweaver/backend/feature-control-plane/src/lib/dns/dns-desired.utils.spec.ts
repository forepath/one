import type { DnsZoneSpec } from '@forepath/loadweaver/shared/util-model';

import { desiredDnsRecords, diffDnsRecords, ownershipName, zoneFor } from './dns-desired.utils';

const zone = (name: string): DnsZoneSpec => ({
  zone: name,
  provider: 'cf',
  secondaries: [],
  dnssec: false,
  defaultTtl: 300,
});
const zones = new Map([
  ['example', zone('example.com')],
  ['apps', zone('apps.example.com')],
]);

describe('desired DNS', () => {
  it('finds the longest managed zone', () => {
    expect(zoneFor('www.apps.example.com', zones)).toBe('apps');
    expect(zoneFor('example.com', zones)).toBe('example');
    expect(zoneFor('example.org', zones)).toBeUndefined();
    expect(ownershipName('*.apps.example.com')).toBe('_loadweaver.wildcard.apps.example.com');
  });

  it("keeps projects' records off the zone apex and away from delegation", () => {
    const state = desiredDnsRecords(
      zones,
      [
        {
          name: 'ns',
          project: 'shop',
          spec: { zone: 'example', name: 'sub', type: 'NS', values: ['evil.example.net'] },
        },
        { name: 'apex', project: 'shop', spec: { zone: 'example', name: '@', type: 'TXT', values: ['x'] } },
        { name: 'ok', project: 'shop', spec: { zone: 'example', name: 'shop', type: 'TXT', values: ['x'] } },
      ],
      [],
      [],
    );

    expect(state.records.map((r) => r.fqdn)).toEqual(['shop.example.com']);
    expect(state.errors).toHaveLength(2);
    expect(state.errors[0]).toContain("project records can't be NS records or sit at the zone apex");
  });

  it('publishes ingress hostnames and declared records, and rejects double definitions', () => {
    const state = desiredDnsRecords(
      zones,
      [
        { name: 'mx', spec: { zone: 'example', name: '@', type: 'MX', values: ['mx.example.net'], priority: 10 } },
        { name: 'clash', project: 'shop', spec: { zone: 'example', name: 'www', type: 'A', values: ['192.0.2.1'] } },
      ],
      ['www.example.com', 'shop.apps.example.com', 'blog.example.org'],
      ['203.0.113.10', '2001:db8::10'],
    );

    expect(state.records.map((r) => `${r.type} ${r.fqdn} ${r.values.join(',')} @${r.zone}`)).toEqual([
      'MX example.com mx.example.net @example',
      'A shop.apps.example.com 203.0.113.10 @apps',
      'AAAA shop.apps.example.com 2001:db8::10 @apps',
      'A www.example.com 192.0.2.1 @example',
      'AAAA www.example.com 2001:db8::10 @example',
    ]);
    expect(state.errors).toEqual([
      'A www.example.com is defined by both DnsRecord shop/clash and ingress www.example.com',
    ]);
    expect(state.warnings).toEqual([
      'blog.example.org is in no managed zone; point it at 203.0.113.10, 2001:db8::10 yourself',
    ]);
  });

  it('describes the plan effect', () => {
    const a = desiredDnsRecords(zones, [], ['www.example.com'], ['203.0.113.10']).records;
    const b = desiredDnsRecords(zones, [], ['www.example.com', 'new.example.com'], ['203.0.113.11']).records;

    expect(diffDnsRecords(a, b)).toEqual([
      { action: 'create', zone: 'example', fqdn: 'new.example.com', type: 'A', values: ['203.0.113.11'] },
      {
        action: 'update',
        zone: 'example',
        fqdn: 'www.example.com',
        type: 'A',
        values: ['203.0.113.11'],
        previous: ['203.0.113.10'],
      },
    ]);
    expect(diffDnsRecords(b, [])).toHaveLength(2);
  });
});
