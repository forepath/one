import type { DnsZoneSpec } from '@forepath/loadweaver/shared/util-model';

import { nameServerWarnings, zoneNameServers } from './hosted-zones.utils';
import { nextSerial, renderZoneFile, txtData, zoneBody } from './zone-file';

const zone: DnsZoneSpec = { zone: 'example.com', provider: 'ns', secondaries: [], dnssec: false, defaultTtl: 300 };
const node = (name: string, site: string, endpointHost: string | null) => ({
  name,
  site,
  labels: null,
  lifecycle: 'active',
  controlPlane: true,
  endpointHost,
});

describe('zone files', () => {
  it('quotes and splits TXT data', () => {
    expect(txtData('say "hi" \\o/')).toBe('"say \\"hi\\" \\\\o/"');
    expect(txtData('x'.repeat(300)).split('" "')).toHaveLength(2);
  });

  it('renders absolute names, NS with in-zone glue, and records', () => {
    const body = zoneBody(
      zone,
      [
        { zone: 'z', fqdn: 'www.example.com', type: 'A', values: ['203.0.113.10'], ttl: 60, source: 's' },
        { zone: 'z', fqdn: 'example.com', type: 'MX', values: ['mx.example.net'], ttl: 300, priority: 5, source: 's' },
        {
          zone: 'z',
          fqdn: '_sip._tcp.example.com',
          type: 'SRV',
          values: ['5 5060 sip.example.com'],
          ttl: 300,
          priority: 10,
          source: 's',
        },
      ],
      [
        { name: 'ns1.example.com', addresses: ['198.51.100.1', '2001:db8::1'] },
        { name: 'ns.other.net', addresses: ['192.0.2.1'] },
      ],
    );

    expect(body.split('\n')).toEqual([
      'example.com. 300 IN NS ns1.example.com.',
      'ns1.example.com. 300 IN A 198.51.100.1',
      'ns1.example.com. 300 IN AAAA 2001:db8::1',
      'example.com. 300 IN NS ns.other.net.',
      'www.example.com. 60 IN A 203.0.113.10',
      'example.com. 300 IN MX 5 mx.example.net.',
      '_sip._tcp.example.com. 300 IN SRV 10 5 5060 sip.example.com.',
    ]);
    expect(renderZoneFile(zone, body, 42, 'ns1.example.com')).toContain(
      'example.com. 300 IN SOA ns1.example.com. hostmaster.example.com. 42 3600 600 1209600 300',
    );
  });

  it('leaves NS to declared records when the zone declares them', () => {
    const body = zoneBody(
      zone,
      [{ zone: 'z', fqdn: 'example.com', type: 'NS', values: ['a.ns.net'], ttl: 300, source: 's' }],
      [{ name: 'ns1.example.com', addresses: ['198.51.100.1'] }],
    );

    expect(body).toBe('example.com. 300 IN NS a.ns.net.');
  });

  it('keeps serials increasing', () => {
    const now = new Date('2027-01-01T00:00:00Z');

    expect(nextSerial(undefined, now)).toBe(now.getTime() / 1000);
    expect(nextSerial(now.getTime() / 1000 + 10, now)).toBe(now.getTime() / 1000 + 11);
  });

  it('names the name servers and warns about weak delegations', () => {
    const nodes = [
      node('n1', 'fra1', '198.51.100.1'),
      node('n2', 'fra1', '198.51.100.2'),
      node('n3', 'ams1', 'n3.example.net'),
    ];

    expect(zoneNameServers(zone, nodes).map((n) => n.name)).toEqual(['ns1.example.com', 'ns2.example.com']);
    expect(nameServerWarnings(zone, nodes)).toEqual(['zone example.com: all name servers are in site fra1']);
    expect(nameServerWarnings(zone, nodes.slice(0, 1))).toEqual([
      'zone example.com: fewer than two name servers with public addresses (single point of failure)',
    ]);
    expect(nameServerWarnings(zone, [nodes[0], node('n4', 'ams1', '198.51.100.4')])).toEqual([]);
  });
});
