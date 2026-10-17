import {
  cpuCores,
  DeniedFlows,
  dockerUsage,
  parseNetDev,
  parseNftCounters,
  parseProcStat,
  quantile,
  RequestStats,
} from './metrics-parsing';

describe('node metrics (3.18)', () => {
  it('computes CPU cores from /proc/stat deltas and reads interface counters', () => {
    const a = parseProcStat('cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3');
    const b = parseProcStat('cpu  200 0 200 800 100 0 0 0 0 0');

    expect(a).toEqual({ busy: 200, total: 1000 });
    expect(cpuCores(a as never, b as never, 4)).toBeCloseTo((200 / 300) * 4);
    expect(
      parseNetDev(
        'Inter-|...\n face |...\n  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0\n    lo: 5 0 0 0 0 0 0 0 5 0 0 0 0 0 0 0',
      ).get('eth0'),
    ).toEqual({
      rx: 1000,
      tx: 2000,
    });
  });

  it('reads rule counters per policy edge with their decision', () => {
    const json = JSON.stringify({
      nftables: [
        {
          rule: {
            handle: 7,
            comment: 'shop/web-api',
            expr: [
              { match: { left: { payload: { protocol: 'ip', field: 'saddr' } }, right: '@lw_00000001_4' } },
              { match: { left: { payload: { protocol: 'ip', field: 'daddr' } }, right: '@lw_00000002_4' } },
              { match: { left: { payload: { protocol: 'tcp', field: 'dport' } }, right: 8080 } },
              { counter: { packets: 10, bytes: 900 } },
              { accept: null },
            ],
          },
        },
        {
          rule: {
            handle: 8,
            comment: 'shop/trial observed',
            expr: [{ counter: { packets: 2, bytes: 80 } }, { accept: null }],
          },
        },
        {
          rule: {
            handle: 9,
            expr: [{ log: { prefix: 'lwdeny ' } }, { counter: { packets: 3, bytes: 120 } }, { drop: null }],
          },
        },
        // The monitor rule's log line has no counter.
        { rule: { handle: 10, expr: [{ log: { prefix: 'lwobs x ' } }] } },
      ],
    });

    expect(parseNftCounters(json)).toEqual([
      {
        handle: 7,
        policy: 'shop/web-api',
        src: 'lw_00000001',
        dst: 'lw_00000002',
        protocol: 'tcp',
        port: 8080,
        decision: 'allowed',
        packets: 10,
        bytes: 900,
      },
      {
        handle: 8,
        policy: 'shop/trial',
        src: '*',
        dst: '*',
        protocol: 'any',
        port: 0,
        decision: 'observed',
        packets: 2,
        bytes: 80,
      },
      {
        handle: 9,
        policy: 'builtin:default-deny',
        src: '*',
        dst: '*',
        protocol: 'any',
        port: 0,
        decision: 'denied',
        packets: 3,
        bytes: 120,
      },
    ]);
    expect(parseNftCounters('not json')).toEqual([]);
  });

  it('aggregates ingress requests and denied flows per interval', () => {
    const stats = new RequestStats();

    for (const [status, ms] of [
      [200, 10],
      [200, 20],
      [503, 300],
      [200, 40],
    ] as const)
      stats.record('Shop.Example.com:443', status, ms);

    expect(stats.drain()).toEqual([{ host: 'shop.example.com', requests: 4, errors: 1, p50: 20, p95: 300, p99: 300 }]);
    expect(stats.drain()).toEqual([]);
    expect(quantile([], 0.5)).toBe(0);

    const denied = new DeniedFlows();

    denied.record('10.42.1.10', '10.42.2.10', 'TCP', 5432);
    denied.record('10.42.1.10', '10.42.2.10', 'TCP', 5432);
    expect(denied.drain()).toEqual([{ src: '10.42.1.10', dst: '10.42.2.10', protocol: 'tcp', port: 5432, packets: 2 }]);
  });

  it('reads container CPU and memory from Docker stats', () => {
    expect(
      dockerUsage({
        cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 20_000, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 10_000 },
        memory_stats: { usage: 1000, stats: { inactive_file: 200 } },
      }),
    ).toEqual({ cores: 0.4, memoryBytes: 800 });
  });
});
