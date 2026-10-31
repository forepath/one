import { databaseTarget } from '../database-handover/database-target.runtime';
import { MetricsStore } from './metrics.store';
import { frozenMetricsAsOf, LiveTraffic, liveTraffic, resetFrozenMetricsAsOf } from './read-only-metrics';

const flow = (decision: 'allowed' | 'denied', packets: number) => ({
  policy: 'p',
  src: 'a',
  dst: 'b',
  protocol: 'tcp' as const,
  port: 80,
  decision,
  packets,
  bytes: packets * 100,
});

describe('live traffic during the read-only fallback (3.43)', () => {
  it('sums the latest requests per second per node and host of the last minute', () => {
    const traffic = new LiveTraffic();
    const rps = (entity: string, value: number) => ({ metric: 'ingress.requests_per_s', entity, value });

    traffic.record('n1', { samples: [rps('a.example.com', 5), rps('b.example.com', 2)], flows: [] }, 0);
    traffic.record('n1', { samples: [rps('a.example.com', 7)], flows: [] }, 10_000);
    traffic.record(
      'n2',
      { samples: [rps('a.example.com', 1), { metric: 'node.cpu', entity: 'n2', value: 9 }], flows: [] },
      10_000,
    );

    expect(traffic.requestsPerSecond(10_000)).toBe(7 + 2 + 1);
    // b.example.com's last sample is older than a minute: no longer counted.
    expect(traffic.requestsPerSecond(65_000)).toBe(7 + 1);
    expect(traffic.requestsPerSecond(200_000)).toBe(0);
  });

  it('counts denied packets of the last 5 minutes', () => {
    const traffic = new LiveTraffic();

    traffic.record('n1', { samples: [], flows: [flow('denied', 3), flow('allowed', 50)] }, 0);
    traffic.record('n2', { samples: [], flows: [flow('denied', 4)] }, 240_000);

    expect(traffic.deniedPackets5m(240_000)).toBe(7);
    expect(traffic.deniedPackets5m(301_000)).toBe(4);
  });

  it('the stored metrics are as of the last sample, only during the fallback (cached)', async () => {
    resetFrozenMetricsAsOf();

    const query = jest.fn(async () => [{ t: '2026-10-31T08:59:50.000Z' }]);

    expect(await frozenMetricsAsOf({ query } as never, 0, false)).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect((await frozenMetricsAsOf({ query } as never, 0, true))?.toISOString()).toBe('2026-10-31T08:59:50.000Z');
    await frozenMetricsAsOf({ query } as never, 30_000, true);
    expect(query).toHaveBeenCalledTimes(1);

    resetFrozenMetricsAsOf();
    expect(await frozenMetricsAsOf({ query: async () => [{ t: null }] } as never, 0, true)).toBeNull();
  });

  it('ingest keeps the report in memory instead of inserting during the fallback', async () => {
    databaseTarget.setFallback(true);
    liveTraffic.clear();

    const query = jest.fn(async () => []);
    const store = new MetricsStore(
      {
        query,
        getRepository: () => ({ find: async () => [] }),
      } as never,
      {} as never,
    );

    try {
      const result = await store.ingest('n1', {
        at: new Date().toISOString(),
        samples: [
          { metric: 'ingress.requests_per_s', entity: 'shop.example.com', value: 12 },
          { metric: 'ingress.requests_per_s', entity: '<bad>', value: 99 },
        ],
        flows: [flow('denied', 5)],
      } as never);

      expect(result).toEqual({ samples: 0, rejected: 1 });
      expect(query).not.toHaveBeenCalled();
      expect(liveTraffic.requestsPerSecond(Date.now())).toBe(12);
      expect(liveTraffic.deniedPackets5m(Date.now())).toBe(5);
    } finally {
      databaseTarget.reset();
      liveTraffic.clear();
    }
  });
});
