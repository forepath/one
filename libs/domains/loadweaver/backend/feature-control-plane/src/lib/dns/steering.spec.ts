import type { DnsFailoverSpec } from '@forepath/loadweaver/shared/util-model';

import { assignProbes, failoverAnswers, failoverPlanNotes } from './dns-failover.utils';
import { steeringIssues } from './dns-zones.utils';
import {
  bucketNetworks,
  chooseLatency,
  MAX_VIEWS,
  steer,
  steeringViews,
  STEERING_BUCKETS,
  weightedBuckets,
  type SteeredHost,
} from './steering.utils';

const spec = (extra: Partial<DnsFailoverSpec>): DnsFailoverSpec => ({
  host: 'www.example.com',
  mode: 'failover',
  endpoints: [
    { name: 'fra', address: '203.0.113.10', site: 'fra1' },
    { name: 'nyc', address: '198.51.100.10', site: 'nyc1' },
  ],
  check: { protocol: 'https', path: '/', expectStatus: [200, 399] },
  intervalSeconds: 10,
  failAfter: 3,
  recoverAfter: 3,
  failback: 'auto',
  stableSeconds: 600,
  ttl: 30,
  ...extra,
});

describe('DNS steering', () => {
  it('splits the address space into buckets', () => {
    expect(bucketNetworks(0)).toEqual(['0.0.0.0/10', '2000::/13']);
    expect(bucketNetworks(1)).toEqual(['0.64.0.0/10', '2008::/13']);
    expect(bucketNetworks(STEERING_BUCKETS - 1)).toEqual(['255.192.0.0/10', '3ff8::/13']);
  });

  it('assigns buckets by weight, spread over the address space', () => {
    const buckets = weightedBuckets([
      { name: 'b', weight: 20 },
      { name: 'a', weight: 80 },
    ]);
    const share = (name: string, from: number, to: number) => buckets.slice(from, to).filter((b) => b === name).length;

    expect(buckets).toHaveLength(STEERING_BUCKETS);
    expect(share('a', 0, STEERING_BUCKETS)).toBeGreaterThanOrEqual(818);
    expect(share('a', 0, STEERING_BUCKETS)).toBeLessThanOrEqual(820);
    // Every quarter of the address space gets about the same split.
    for (let q = 0; q < 4; q++) expect(Math.abs(share('b', q * 256, (q + 1) * 256) - 51)).toBeLessThanOrEqual(2);
    expect(weightedBuckets([{ name: 'a', weight: 0 }])).toEqual([]);
  });

  it('answers weighted, geo and latency per client, without unhealthy endpoints', () => {
    const weighted = steer(
      spec({
        mode: 'weighted',
        endpoints: [
          { name: 'fra', address: '203.0.113.10', weight: 3 },
          { name: 'nyc', address: '198.51.100.10', weight: 1 },
        ],
      }),
      ['fra', 'nyc'],
      undefined,
    );

    expect(weighted.addresses).toEqual(['203.0.113.10', '198.51.100.10']);
    expect(weighted.steering?.buckets?.filter((b) => b[0] === '203.0.113.10')).toHaveLength(768);
    // One endpoint left: no split.
    expect(steer(spec({ mode: 'weighted' }), ['nyc'], undefined)).toEqual({ addresses: ['198.51.100.10'] });

    const geo = spec({
      mode: 'geo',
      endpoints: [
        { name: 'fra', address: '203.0.113.10', continents: ['EU'], countries: ['TR'] },
        { name: 'nyc', address: '198.51.100.10' },
      ],
    });

    expect(steer(geo, ['fra', 'nyc'], undefined)).toEqual({
      addresses: ['198.51.100.10'],
      steering: {
        geo: new Map([
          ['country:TR', ['203.0.113.10']],
          ['continent:EU', ['203.0.113.10']],
        ]),
      },
    });
    expect(steer(geo, ['nyc'], undefined).steering).toBeUndefined();

    const latency = steer(spec({ mode: 'latency' }), ['fra', 'nyc'], {
      default: 'nyc',
      byContinent: { EU: 'fra', NA: 'nyc' },
    });

    expect(latency.addresses).toEqual(['198.51.100.10']);
    expect(latency.steering?.geo).toEqual(
      new Map([
        ['continent:EU', ['203.0.113.10']],
        ['continent:NA', ['198.51.100.10']],
      ]),
    );
  });

  it('steers each continent to the endpoint its nearest probing site measures fastest, with hysteresis', () => {
    const sites = new Map([
      ['fra1', { latitude: 50.1, longitude: 8.7 }],
      ['nyc1', { latitude: 40.7, longitude: -74 }],
    ]);
    const latency = (fraFromFra: number) =>
      new Map([
        [
          'fra',
          new Map([
            ['fra1', fraFromFra],
            ['nyc1', 90],
          ]),
        ],
        [
          'nyc',
          new Map([
            ['fra1', 85],
            ['nyc1', 2],
          ]),
        ],
      ]);
    const first = chooseLatency(['fra', 'nyc'], latency(3), sites, undefined);

    // Africa's centre is over 5,000 km from both sites: no vantage point there.
    expect(first).toEqual({ default: 'nyc', byContinent: { EU: 'fra', NA: 'nyc' } });
    // fra got slower from fra1 but is still not clearly worse than nyc: no move. Clearly worse: move.
    expect(chooseLatency(['fra', 'nyc'], latency(80), sites, first).byContinent.EU).toBe('fra');
    expect(chooseLatency(['fra', 'nyc'], latency(120), sites, first).byContinent.EU).toBe('nyc');
    // Unhealthy endpoints are never chosen.
    expect(chooseLatency(['nyc'], latency(3), sites, first).byContinent.EU).toBe('nyc');
  });

  it('builds views from the most specific match down, within the limit', () => {
    const hosts: SteeredHost[] = [
      {
        zone: 'ex',
        fqdn: 'www.example.com',
        addresses: ['198.51.100.10'],
        steering: {
          geo: new Map([
            ['country:TR', ['203.0.113.10']],
            ['continent:EU', ['203.0.113.11']],
          ]),
        },
      },
      {
        zone: 'ex',
        fqdn: 'api.example.com',
        addresses: ['192.0.2.1', '192.0.2.2'],
        steering: {
          geo: new Map(),
          buckets: Array.from({ length: STEERING_BUCKETS }, (_, i) => [i % 2 ? '192.0.2.2' : '192.0.2.1']),
        },
      },
    ];
    const views = steeringViews(hosts, true);

    if ('error' in views) throw new Error(views.error);

    // (TR, EU, none) × (2 groups + none) minus (none, none, none).
    expect(views).toHaveLength(2 * 2 * 3 - 1);
    expect(views[0]).toMatchObject({ name: 'lw-1', country: 'TR', continent: 'EU' });
    expect(views[0].answers.get('www.example.com')).toEqual(['203.0.113.10']);
    expect(views[0].networks).toHaveLength(STEERING_BUCKETS);
    expect(views[0].answers.get('api.example.com')).toEqual(['192.0.2.1']);

    const euOnly = views.find((v) => !v.country && v.continent === 'EU' && !v.networks);

    expect(euOnly?.answers.get('www.example.com')).toEqual(['203.0.113.11']);
    expect(euOnly?.answers.get('api.example.com')).toEqual(['192.0.2.1', '192.0.2.2']);
    // Without GeoIP, only the buckets are steered.
    expect((steeringViews(hosts, false) as unknown[]).length).toBe(2);

    const many = Array.from(
      { length: 40 },
      (_, i) => `country:${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`,
    );

    expect(
      steeringViews(
        [{ ...hosts[0], steering: { geo: new Map(many.map((k) => [k, ['203.0.113.10']])) } }, hosts[1]],
        true,
      ),
    ).toEqual({
      error: `DNS steering needs ${41 * 3 - 1} bind9 views, at most ${MAX_VIEWS} are supported`,
    });
  });

  it('exposes steering through the failover answers', () => {
    const answers = failoverAnswers(new Map([['www', spec({ mode: 'weighted' })]]), new Map());

    expect(answers[0].addresses).toEqual(['203.0.113.10', '198.51.100.10']);
    expect(answers[0].steering?.buckets).toHaveLength(STEERING_BUCKETS);
  });

  it('rejects steering into AXFR transfers and warns about API providers', () => {
    const host: SteeredHost = { zone: 'ex', fqdn: 'www.example.com', addresses: [], steering: { geo: new Map() } };
    const zones = new Map([
      ['ex', { zone: 'example.com', provider: 'ns', secondaries: ['cf'], dnssec: false, defaultTtl: 300 }],
    ]);

    expect(
      steeringIssues(
        [host],
        zones,
        new Map([
          ['ns', { type: 'bind9' }],
          ['cf', { type: 'cloudflare', credentials: 'secret://p/cf' }],
        ]),
      ),
    ).toEqual({ errors: [], warnings: ['www.example.com: only hosted bind9 steers; cf answers everyone the default'] });
    expect(
      steeringIssues(
        [host],
        zones,
        new Map([
          ['ns', { type: 'bind9' }],
          ['cf', { type: 'axfr', credentials: 'secret://p/t', servers: ['192.0.2.1'] }],
        ]),
      ).errors,
    ).toEqual(["www.example.com: steered answers can't be transferred to the AXFR secondaries of zone example.com"]);
  });
});

describe('DNS failover probes and plan notes', () => {
  it('measures latency from every site and tops up single-site clusters with an external probe location', () => {
    const nodes = [
      { name: 'f1', site: 'fra1' },
      { name: 'f2', site: 'fra1' },
      { name: 'w', site: 'external' },
    ];
    const single = assignProbes(
      new Map([['www', spec({ endpoints: [{ name: 'fra', address: '203.0.113.10', site: 'fra1' }] })]]),
      nodes,
    );

    // The witness outside, plus the site itself: two votes.
    expect([...single.keys()].sort()).toEqual(['f1', 'f2', 'w']);

    const latency = assignProbes(new Map([['www', spec({ mode: 'latency' })]]), [
      ...nodes,
      { name: 'n1', site: 'nyc1' },
    ]);

    expect(latency.get('f1')?.map((p) => p.id)).toEqual(['www/fra', 'www/nyc']);
  });

  it('states recovery time, broken L4 connections and missing steering prerequisites', () => {
    const notes = failoverPlanNotes(
      new Map([
        ['www', spec({ mode: 'latency' })],
        [
          'db',
          spec({
            host: 'db.example.com',
            check: { protocol: 'tcp', path: '/', expectStatus: [200, 399] },
            endpoints: [{ name: 'fra', address: '203.0.113.10', site: 'fra1' }],
          }),
        ],
      ]),
      [{ name: 'f1', site: 'fra1' }],
      new Set(),
      false,
    ).map((n) => `${n.level}: ${n.message}`);

    expect(notes).toEqual([
      'info: www.example.com: DNS failover recovers in about 70 s (3 × 10 s detection, update, 30 s TTL); some resolvers and clients cache longer than the TTL',
      'warning: www.example.com: fra is only probed from its own site fra1; add an external probe location (e.g. the witness on a small VPS in another site)',
      'warning: www.example.com: latency steering needs a GeoIP database (release bundle or LOADWEAVER_GEOIP_DB); until then everyone gets the default answer',
      'warning: www.example.com: latency steering needs sites with a location; until then everyone gets the endpoint fastest on average',
      'info: db.example.com: DNS failover recovers in about 70 s (3 × 10 s detection, update, 30 s TTL); some resolvers and clients cache longer than the TTL',
      'info: db.example.com: on a switch, existing connections break; clients must reconnect and resolve again',
      'warning: db.example.com: fra is only probed from its own site fra1; add an external probe location (e.g. the witness on a small VPS in another site)',
    ]);
  });
});
