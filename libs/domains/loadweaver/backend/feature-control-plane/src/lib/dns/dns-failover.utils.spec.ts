import type { DnsFailoverSpec } from '@forepath/loadweaver/shared/util-model';

import { assignProbes, evaluateFailover, type FailoverState, type ProbeVote } from './dns-failover.utils';

const spec = (extra: Partial<DnsFailoverSpec> = {}): DnsFailoverSpec => ({
  host: 'www.example.com',
  mode: 'failover',
  endpoints: [
    { name: 'fra', address: '203.0.113.10', site: 'fra1' },
    { name: 'ams', address: '198.51.100.10', site: 'ams1' },
  ],
  check: { protocol: 'https', path: '/health', expectStatus: [200, 399] },
  intervalSeconds: 10,
  failAfter: 3,
  recoverAfter: 3,
  failback: 'auto',
  stableSeconds: 600,
  ttl: 30,
  ...extra,
});
const T0 = new Date('2026-07-01T00:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const votes = (time: Date, fra: boolean[], ams: boolean[] = [true, true]) =>
  new Map<string, ProbeVote[]>([
    ['fra', fra.map((ok) => ({ ok, at: time }))],
    ['ams', ams.map((ok) => ({ ok, at: time }))],
  ]);

function rounds(
  s: DnsFailoverSpec,
  from: FailoverState | undefined,
  count: number,
  start: number,
  fra: boolean[],
  quorum = true,
) {
  let state = from;
  let last;

  for (let i = 0; i < count; i++) {
    last = evaluateFailover(s, state, votes(at(start + i * 10), fra), at(start + i * 10), quorum);
    state = last.state;
  }

  return { state: state as FailoverState, last };
}

describe('DNS failover engine', () => {
  it('probes from other sites than the endpoint', () => {
    const probes = assignProbes(new Map([['www', spec()]]), [
      { name: 'f1', site: 'fra1' },
      { name: 'f2', site: 'fra1' },
      { name: 'f3', site: 'fra1' },
      { name: 'a1', site: 'ams1' },
    ]);

    expect(probes.get('a1')?.map((p) => p.id)).toEqual(['www/fra']);
    // fra has a single prober outside its site: topped up from inside for the two votes a decision needs.
    expect(probes.get('f1')?.map((p) => p.id)).toEqual(['www/fra', 'www/ams']);
    expect(probes.get('f2')?.map((p) => p.id)).toEqual(['www/fra', 'www/ams']);
    expect(probes.has('f3')).toBe(false);
    expect(probes.get('a1')?.[0]).toMatchObject({
      address: '203.0.113.10',
      port: 443,
      protocol: 'https',
      host: 'www.example.com',
      path: '/health',
    });
  });

  it('fails over after N failed rounds, only with quorum, and fails back after the stable period', () => {
    const start = evaluateFailover(spec(), undefined, votes(T0, [true, true]), T0, true).state;

    expect(start.active).toEqual(['fra']);
    expect(rounds(spec(), start, 2, 10, [false, false]).state.active).toEqual(['fra']);
    // No control-plane quorum: no switch, however long it fails.
    expect(rounds(spec(), start, 5, 10, [false, false], false).state.active).toEqual(['fra']);

    const down = rounds(spec(), start, 3, 10, [false, false]);

    expect(down.state.active).toEqual(['ams']);
    expect(down.last?.flipped).toEqual(['fra']);

    // One healthy and one failed vote is no majority.
    expect(rounds(spec(), down.state, 5, 100, [true, false]).state.endpoints['fra'].healthy).toBe(false);

    const recovered = rounds(spec(), down.state, 3, 100, [true, true]);

    expect(recovered.state.endpoints['fra'].healthy).toBe(true);
    // Recovered, but not yet stable for 10 minutes.
    expect(recovered.state.active).toEqual(['ams']);
    expect(evaluateFailover(spec(), recovered.state, votes(at(800), [true, true]), at(800), true).state.active).toEqual(
      ['fra'],
    );
  });

  it('waits for an operator with manual fail-back', () => {
    const s = spec({ failback: 'manual', stableSeconds: 0 });
    const down = rounds(s, undefined, 3, 0, [false, false]).state;
    const healthy = rounds(s, down, 3, 100, [true, true]).state;

    expect(healthy).toMatchObject({ active: ['ams'], failbackPending: true });
    expect(evaluateFailover(s, healthy, votes(at(200), [true, true]), at(200), true, true).state.active).toEqual([
      'fra',
    ]);
  });

  it('answers every healthy endpoint in multi-value mode, everything when none is healthy', () => {
    const s = spec({ mode: 'multi-value', failAfter: 1 });

    expect(evaluateFailover(s, undefined, votes(T0, [true, true]), T0, true).state.active).toEqual(['fra', 'ams']);
    expect(evaluateFailover(s, undefined, votes(T0, [false, false]), T0, true).state.active).toEqual(['ams']);
    expect(evaluateFailover(s, undefined, votes(T0, [false, false], [false, false]), T0, true).state.active).toEqual([
      'fra',
      'ams',
    ]);
  });

  it('ignores stale and single votes', () => {
    const stale = new Map<string, ProbeVote[]>([
      [
        'fra',
        [
          { ok: false, at: T0 },
          { ok: false, at: T0 },
        ],
      ],
    ]);

    expect(
      evaluateFailover(spec({ failAfter: 1 }), undefined, stale, at(100), true).state.endpoints['fra'].healthy,
    ).toBe(true);
    expect(
      evaluateFailover(spec({ failAfter: 1 }), undefined, new Map([['fra', [{ ok: false, at: T0 }]]]), T0, true).state
        .endpoints['fra'].healthy,
    ).toBe(true);
  });
});
