import { parseResource, RESOURCE_KIND_NAMES, resourceJsonSchema } from '../resource';
import { peerMaxPrefixes } from './bgp';

const doc = (kind: string, spec: unknown, name = 'x') => ({
  apiVersion: 'loadweaver.com/v1',
  kind,
  metadata: { name },
  spec,
});
const ok = (kind: string, spec: unknown) => parseResource(doc(kind, spec)).ok;

describe('edge resources', () => {
  it('requires credentials for external DNS providers and none for bind9', () => {
    expect(ok('DnsProvider', { type: 'cloudflare', credentials: 'secret://infra/cloudflare' })).toBe(true);
    expect(ok('DnsProvider', { type: 'cloudflare' })).toBe(false);
    expect(ok('DnsProvider', { type: 'bind9', nodeGroup: 'dns' })).toBe(true);
    expect(ok('DnsProvider', { type: 'bind9', credentials: 'secret://infra/x' })).toBe(false);
    expect(ok('DnsProvider', { type: 'cloudflare', credentials: 'plain-token' })).toBe(false);
  });

  it('takes servers and a TSIG secret for zone transfers', () => {
    const axfr = { type: 'axfr', credentials: 'secret://infra/tsig', servers: ['192.0.2.53', '2001:db8::53'] };

    expect(ok('DnsProvider', axfr)).toBe(true);
    expect(ok('DnsProvider', { ...axfr, tsigAlgorithm: 'hmac-sha512' })).toBe(true);
    expect(ok('DnsProvider', { type: 'axfr', credentials: 'secret://infra/tsig' })).toBe(false);
    expect(ok('DnsProvider', { type: 'axfr', servers: ['192.0.2.53'] })).toBe(false);
    expect(ok('DnsProvider', { ...axfr, servers: ['ns.example.com'] })).toBe(false);
    expect(ok('DnsProvider', { type: 'bind9', servers: ['192.0.2.53'] })).toBe(false);
  });

  it('takes a registrar for DS publication', () => {
    const zone = { zone: 'example.com', provider: 'ns', dnssec: true };

    expect(ok('DnsZone', { ...zone, registrar: { type: 'inwx', credentials: 'secret://infra/inwx' } })).toBe(true);
    expect(ok('DnsZone', { ...zone, registrar: { type: 'inwx' } })).toBe(false);
  });

  it('validates zones and records', () => {
    expect(ok('DnsZone', { zone: 'example.com', provider: 'cf', secondaries: ['ns'] })).toBe(true);
    expect(ok('DnsZone', { zone: 'example.com', provider: 'cf', secondaries: ['cf'] })).toBe(false);
    expect(ok('DnsRecord', { zone: 'example', name: 'www', type: 'A', values: ['203.0.113.10'] })).toBe(true);
    expect(ok('DnsRecord', { zone: 'rev', name: '10', type: 'PTR', values: ['www.example.com.'] })).toBe(true);
    expect(ok('DnsRecord', { zone: 'rev', name: '10', type: 'PTR', values: ['not a host'] })).toBe(false);
    expect(ok('DnsRecord', { zone: 'example', name: 'www', type: 'A', values: ['2001:db8::1'] })).toBe(false);
    expect(ok('DnsRecord', { zone: 'example', name: '@', type: 'CNAME', values: ['a.example.net'] })).toBe(false);
    expect(ok('DnsRecord', { zone: 'example', name: '@', type: 'MX', values: ['mx.example.com'] })).toBe(false);
    expect(ok('DnsRecord', { zone: 'example', name: '*.apps', type: 'AAAA', values: ['2001:db8::1'] })).toBe(true);
  });

  it('ties the provider block to provider failover', () => {
    expect(ok('IpPool', { cidrs: ['203.0.113.0/28'], nodeGroup: 'ingress', failover: 'bgp' })).toBe(true);
    expect(ok('IpPool', { cidrs: ['203.0.113.10/32'], nodeGroup: 'ingress', failover: 'provider' })).toBe(false);
    expect(
      ok('IpPool', {
        cidrs: ['203.0.113.10/32'],
        nodeGroup: 'ingress',
        failover: 'provider',
        provider: { type: 'hetzner', credentials: 'secret://infra/hcloud' },
      }),
    ).toBe(true);
    expect(ok('IpPool', { cidrs: ['203.0.113.1/24'], nodeGroup: 'ingress', failover: 'vrrp' })).toBe(false);
  });
});

describe('DNS failover steering', () => {
  const failover = (mode: string, endpoints: Record<string, unknown>[]) => ({
    host: 'www.example.com',
    mode,
    endpoints: endpoints.map((e, i) => ({ name: `e${i}`, address: `203.0.113.${i + 1}`, ...e })),
  });

  it('takes weights, regions and latency per mode only', () => {
    expect(ok('DnsFailover', failover('weighted', [{ weight: 80 }, { weight: 20 }]))).toBe(true);
    expect(ok('DnsFailover', failover('weighted', [{ weight: 0 }, { weight: 0 }]))).toBe(false);
    expect(ok('DnsFailover', failover('failover', [{ weight: 80 }]))).toBe(false);
    expect(ok('DnsFailover', failover('geo', [{ countries: ['DE', 'AT'] }, { continents: ['NA'] }, {}]))).toBe(true);
    expect(ok('DnsFailover', failover('geo', [{}, {}]))).toBe(false);
    expect(ok('DnsFailover', failover('geo', [{ countries: ['de'] }]))).toBe(false);
    expect(ok('DnsFailover', failover('multi-value', [{ continents: ['EU'] }]))).toBe(false);
    expect(ok('DnsFailover', failover('latency', [{ site: 'fra1' }, { site: 'nyc1' }]))).toBe(true);
  });
});

describe('DNS record values', () => {
  const rec = (type: string, values: string[], extra: Record<string, unknown> = {}) =>
    ok('DnsRecord', { zone: 'z', name: 'x', type, values, ...extra });

  it('rejects anything that could break out of a zone file', () => {
    expect(rec('TXT', ['v=spf1 -all'])).toBe(true);
    expect(rec('TXT', ['a\n@ IN NS evil.example.'])).toBe(false);
    expect(rec('CNAME', ['target.example.com.'])).toBe(true);
    expect(rec('CNAME', ['not a host'])).toBe(false);
    expect(rec('MX', ['mx.example.com'], { priority: 10 })).toBe(true);
    expect(rec('SRV', ['5 443 sip.example.com.'], { priority: 10 })).toBe(true);
    expect(rec('SRV', ['443 sip.example.com'], { priority: 10 })).toBe(false);
    expect(rec('CAA', ['0 issue "letsencrypt.org"'])).toBe(true);
    expect(rec('CAA', ['0 issue "a" ; x'])).toBe(false);
  });
});

describe('BGP resources', () => {
  it('validates peers and announcements, with max-prefix defaults per import mode', () => {
    expect(peerMaxPrefixes({ import: 'partial' })).toBe(100_000);
    expect(peerMaxPrefixes({ import: 'default', maxPrefixes: 3 })).toBe(3);
    expect(ok('BgpPeer', { asn: 64500, address: '192.0.2.1', nodeGroup: 'edge', import: 'partial' })).toBe(true);
    expect(ok('BgpPeer', { asn: 64500, address: 'upstream.example', nodeGroup: 'edge' })).toBe(false);
    expect(
      ok('BgpAnnouncement', {
        prefixes: ['203.0.113.0/24'],
        nodeGroup: 'edge',
        communities: ['64500:100'],
        prepend: 2,
      }),
    ).toBe(true);
    expect(ok('BgpAnnouncement', { prefixes: ['203.0.113.0/24'], nodeGroup: 'edge', mode: 'primary-backup' })).toBe(
      false,
    );
    expect(
      ok('AutonomousSystem', {
        asn: 4_200_000_001,
        prefixes: ['203.0.113.0/24', '2001:db8::/48'],
        rtrServers: [{ address: '192.0.2.10' }],
      }),
    ).toBe(true);
  });

  it('publishes JSON Schemas for every kind', () => {
    for (const kind of RESOURCE_KIND_NAMES) expect(Object.keys(resourceJsonSchema(kind)).length).toBeGreaterThan(0);
  });
});
