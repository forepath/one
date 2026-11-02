import { createSocket } from 'node:dgram';

import type { DnsProviderSpec, DnsZoneSpec } from '@forepath/loadweaver/shared/util-model';
import { dnssecDs, generateDnssecKey } from '@forepath/loadweaver/shared/util-pki';

import { zoneSetupIssues } from './dns-zones.utils';
import {
  dnssecActions,
  dnssecMode,
  dnssecPlanSteps,
  expectedDs,
  sameDs,
  type DnssecKeyState,
  DNSSEC_ROLLOVER_AFTER_MS,
  KEY_REMOVE_AFTER_MS,
} from './dnssec.utils';
import { decodeDsResponse, encodeDsQuery, queryDs } from './ds-lookup';
import { secondaryDrift, serialBehind } from './propagation';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2027-06-01T00:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const key = (id: string, created: Date, extra: Partial<DnssecKeyState> = {}): DnssecKeyState => ({
  id,
  publicKey: generateDnssecKey().publicKey,
  createdAt: created,
  retiredAt: null,
  dsAtParent: false,
  dsAbsentSince: null,
  ...extra,
});
const zone = (spec: Partial<DnsZoneSpec> = {}): DnsZoneSpec => ({
  zone: 'example.com',
  provider: 'ns',
  secondaries: [],
  dnssec: false,
  defaultTtl: 300,
  ...spec,
});

describe('DNSSEC key lifecycle', () => {
  it('creates the first key and nothing else until a rollover is due', () => {
    expect(dnssecActions(true, [], now)).toEqual([{ type: 'create' }]);
    expect(dnssecActions(true, [key('a', ago(10), { dsAtParent: true })], now)).toEqual([]);
  });

  it('rolls over yearly, only once the current DS is at the parent and the last rollover finished', () => {
    const old = ago(DNSSEC_ROLLOVER_AFTER_MS / DAY + 1);

    expect(dnssecActions(true, [key('a', old)], now)).toEqual([]);
    expect(dnssecActions(true, [key('a', old, { dsAtParent: true })], now)).toEqual([
      { type: 'create' },
      { type: 'retire', id: 'a' },
    ]);
    expect(
      dnssecActions(true, [key('a', old, { dsAtParent: true }), key('z', ago(800), { retiredAt: ago(400) })], now),
    ).toEqual([]);
  });

  it('removes a retired key only after its DS left the parent and the successor is there', () => {
    const retired = (absentDays: number) =>
      key('old', ago(500), { retiredAt: ago(60), dsAbsentSince: ago(absentDays) });

    expect(dnssecActions(true, [key('new', ago(60), { dsAtParent: true }), retired(20)], now)).toEqual([
      { type: 'remove', id: 'old' },
    ]);
    expect(
      dnssecActions(true, [key('new', ago(60), { dsAtParent: true }), retired(KEY_REMOVE_AFTER_MS / DAY - 1)], now),
    ).toEqual([]);
    expect(dnssecActions(true, [key('new', ago(60)), retired(20)], now)).toEqual([]);
  });

  it('goes insecure when switched off and drops the keys once no DS is left', () => {
    const keys = [key('a', ago(100), { dsAtParent: true })];

    expect(dnssecMode(false, keys)).toBe('insecure');
    expect(dnssecActions(false, keys, now)).toEqual([]);
    expect(dnssecActions(false, [key('a', ago(100), { dsAbsentSince: ago(3) })], now)).toEqual([
      { type: 'remove', id: 'a' },
    ]);
    expect(dnssecMode(false, [])).toBeNull();
    expect(dnssecMode(true, keys)).toBe('signed');
  });

  it('asks the parent for both DS records during a rollover, then only the new one', () => {
    const current = key('new', ago(1));
    const old = key('old', ago(400), { retiredAt: ago(1), dsAtParent: true });
    const both = expectedDs('example.com', true, [old, current], now);

    expect(both.map((d) => d.keyTag)).toEqual([current, old].map((k) => dnssecDs('example.com', k.publicKey).keyTag));

    // The new DS just appeared: the old one stays a while longer.
    expect(
      expectedDs(
        'example.com',
        true,
        [
          { ...old, retiredAt: ago(3) },
          { ...current, dsAtParent: true, dsPresentSince: ago(1) },
        ],
        now,
      ),
    ).toHaveLength(2);

    const settled = expectedDs(
      'example.com',
      true,
      [
        { ...old, retiredAt: ago(30) },
        { ...current, dsAtParent: true, dsPresentSince: ago(3) },
      ],
      now,
    );

    expect(settled).toEqual([dnssecDs('example.com', current.publicKey)]);
    expect(expectedDs('example.com', false, [current], now)).toEqual([]);
    expect(sameDs(both, [...both].reverse())).toBe(true);
    expect(sameDs(both, settled)).toBe(false);
  });

  it('describes switching DNSSEC on and off in the plan', () => {
    const on = dnssecPlanSteps(new Map([['ex', zone()]]), new Map([['ex', zone({ dnssec: true })]]));
    const off = dnssecPlanSteps(
      new Map([['ex', zone({ dnssec: true })]]),
      new Map([['ex', zone({ registrar: { type: 'inwx', credentials: 'secret://infra/inwx' } })]]),
    );

    expect(on[0].summary).toContain('publish the DS shown by GET /dns/dnssec');
    expect(off[0].summary).toContain('stays signed until the DS is gone at the parent, then serves unsigned');
  });
});

describe('zone setups', () => {
  const providers = new Map<string, DnsProviderSpec>([
    ['ns', { type: 'bind9' }],
    ['cf', { type: 'cloudflare', credentials: 'secret://infra/cf' }],
    ['ext', { type: 'axfr', credentials: 'secret://infra/tsig', servers: ['192.0.2.53'] }],
  ]);
  const issues = (z: DnsZoneSpec, records = []) => zoneSetupIssues(new Map([['ex', z]]), providers, records);

  it('signs only on hosted bind9 as primary with secondaries that get the signed zone', () => {
    expect(issues(zone({ dnssec: true, secondaries: ['ext'] })).errors).toEqual([]);
    expect(issues(zone({ dnssec: true, secondaries: ['ext'] })).warnings[0]).toContain('without a registrar');
    expect(issues(zone({ dnssec: true, secondaries: ['cf'] })).errors[0]).toContain(
      'cf would serve the records unsigned',
    );
    expect(issues(zone({ dnssec: true, provider: 'cf', secondaries: ['ns'] })).errors[0]).toContain('must be primary');
  });

  it('lets external primaries own their zone, with hosted bind9 as secondary', () => {
    expect(issues(zone({ provider: 'ext', secondaries: ['ns'] })).errors).toEqual([]);
    expect(issues(zone({ provider: 'ext', secondaries: ['cf'] })).errors[0]).toContain('only hosted bind9');
    expect(issues(zone({ provider: 'ext' })).errors[0]).toContain('needs a hosted bind9 secondary');
    expect(
      zoneSetupIssues(new Map([['ex', zone({ provider: 'ext', secondaries: ['ns'] })]]), providers, [
        { zone: 'ex', fqdn: 'www.example.com', type: 'A', values: ['203.0.113.10'], ttl: 300, source: 'ingress' },
      ]).errors[0],
    ).toContain('add these records there instead: A www.example.com (ingress)');
    expect(issues(zone({ provider: 'cf', secondaries: ['ext'] })).errors[0]).toContain('pull from hosted bind9');
    expect(issues(zone({ provider: 'nope' })).errors[0]).toContain('provider nope does not exist');
  });
});

describe('DS lookup', () => {
  const ds = dnssecDs('example.com', generateDnssecKey().publicKey);

  /** An authoritative answer with the owner name compressed against the question. */
  const answer = (query: Buffer, records: (typeof ds)[], rcode = 0) => {
    const header = Buffer.from(query.subarray(0, 12));

    header.writeUInt16BE(0x8400 | rcode, 2);
    header.writeUInt16BE(records.length, 6);

    const rrs = records.map((r) => {
      const rdata = Buffer.concat([
        Buffer.from([r.keyTag >> 8, r.keyTag & 0xff, r.algorithm, r.digestType]),
        Buffer.from(r.digest, 'hex'),
      ]);
      const fixed = Buffer.alloc(10);

      fixed.writeUInt16BE(43, 0);
      fixed.writeUInt16BE(1, 2);
      fixed.writeUInt32BE(3600, 4);
      fixed.writeUInt16BE(rdata.length, 8);

      return Buffer.concat([Buffer.from([0xc0, 12]), fixed, rdata]);
    });

    return Buffer.concat([header, query.subarray(12), ...rrs]);
  };

  it('accepts only authoritative answers to exactly this question', () => {
    const query = encodeDsQuery('example.com', 7);
    const referral = answer(query, []);

    // A referral or a resolver's cached reply (no AA) never means "no DS".
    referral.writeUInt16BE(0x8000, 2);
    expect(() => decodeDsResponse(referral, 7, 'example.com')).toThrow('not authoritative');
    expect(() => decodeDsResponse(answer(encodeDsQuery('example.org', 7), []), 7, 'example.com')).toThrow(
      'answer to another question',
    );
    expect(decodeDsResponse(answer(query, [ds]), 7, 'Example.COM.')).toEqual([ds]);
  });

  it('decodes DS answers, NXDOMAIN and refuses foreign or truncated responses', () => {
    const query = encodeDsQuery('example.com', 7);

    expect(decodeDsResponse(answer(query, [ds]), 7, 'example.com')).toEqual([ds]);
    expect(decodeDsResponse(answer(query, []), 7, 'example.com')).toEqual([]);
    expect(decodeDsResponse(answer(query, [], 3), 7, 'example.com')).toEqual([]);
    expect(() => decodeDsResponse(answer(query, [ds]), 8, 'example.com')).toThrow('unexpected response');
    expect(() => decodeDsResponse(answer(query, [ds], 2), 7, 'example.com')).toThrow('rcode 2');
    expect(() => decodeDsResponse(answer(query, [ds]).subarray(0, 40), 7, 'example.com')).toThrow();
  });

  it('asks a server over UDP', async () => {
    const server = createSocket('udp4');

    server.on('message', (msg, rinfo) => server.send(answer(msg, [ds]), rinfo.port, rinfo.address));
    await new Promise<void>((r) => server.bind(0, '127.0.0.1', r));

    try {
      expect(await queryDs('127.0.0.1', 'example.com', 2_000, server.address().port)).toEqual([ds]);
    } finally {
      server.close();
    }
  });
});

describe('secondary drift', () => {
  it('compares serials with RFC 1982 arithmetic', () => {
    expect(serialBehind(1, 2)).toBe(true);
    expect(serialBehind(2, 2)).toBe(false);
    expect(serialBehind(4_294_967_295, 1)).toBe(true);
    expect(serialBehind(1, 4_294_967_295)).toBe(false);
  });

  it('reports secondaries behind or silent', async () => {
    const serials: Record<string, number | null> = { p: 5, s1: 5, s2: 4, s3: null };
    const query = async (server: string) => serials[server] ?? null;

    expect(await secondaryDrift('example.com', ['p'], ['s1'], query)).toBeNull();
    expect(await secondaryDrift('example.com', ['p'], ['s1', 's2', 's3'], query)).toBe(
      's2 at serial 4, primary at 5; s3 does not answer',
    );
    expect(await secondaryDrift('example.com', ['s3'], ['s1'], query)).toBe('no primary answered for example.com');
  });
});
