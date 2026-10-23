import type { MetricsReport } from '@forepath/loadweaver/shared/util-agent-protocol';

import { MAX_SAMPLES_PER_REPORT, MetricsCollectorService, splitMetricsReport } from './metrics-collector.service';

/** Cumulative counters of one container, as Docker's one-shot stats report them. */
interface Counters {
  cpuNs: number;
  systemNs: number;
  memory: number;
  rx: number;
  tx: number;
}

function setup(containerCount = 1) {
  const counters = new Map<string, Counters>();
  const containers = Array.from({ length: containerCount }, (_, i) => ({
    Id: `c${i}`,
    State: 'running',
    // Created long before the collector started.
    Created: 1_000,
    Labels: { 'loadweaver.com/managed': 'true', 'loadweaver.com/workload': `shop/web/api/${i}` },
  }));

  for (const c of containers) counters.set(c.Id, { cpuNs: 0, systemNs: 0, memory: 1024 ** 3, rx: 0, tx: 0 });

  const docker = {
    listContainers: jest.fn(async () => containers),
    getContainer: jest.fn((id: string) => ({
      stats: jest.fn(async () => {
        const c = counters.get(id);

        if (!c) throw new Error('gone');

        return {
          cpu_stats: { cpu_usage: { total_usage: c.cpuNs }, system_cpu_usage: c.systemNs, online_cpus: 4 },
          memory_stats: { usage: c.memory },
          networks: { eth0: { rx_bytes: c.rx, tx_bytes: c.tx } },
        };
      }),
    })),
  };
  const commands = { run: jest.fn(async () => ({ stdout: '' })) };
  const host = { usage: jest.fn(async () => null) };
  const collector = new MetricsCollectorService(docker as never, commands as never, host as never);

  return { collector, counters, containers, docker };
}

const value = (report: MetricsReport, metric: string, entity = 'shop/web/api/0') =>
  report.samples.find((s) => s.metric === metric && s.entity === entity)?.value;

/** Advances every container by `seconds` at `cores` CPU and `bytesPerS` traffic each way. */
function advance(counters: Map<string, Counters>, seconds: number, cores = 0.5, bytesPerS = 1e6) {
  for (const c of counters.values()) {
    c.cpuNs += cores * seconds * 1e9;
    c.systemNs += 4 * seconds * 1e9;
    c.rx += bytesPerS * seconds;
    c.tx += (bytesPerS / 2) * seconds;
  }
}

describe('MetricsCollectorService usage samples (3.24)', () => {
  const t0 = Date.parse('2026-10-21T12:00:00Z');

  it('integrates the measured time: a skipped tick bills the full 20 s', async () => {
    const { collector, counters } = setup();

    await collector.collect(t0);
    advance(counters, 10);

    const regular = await collector.collect(t0 + 10_000);

    expect(value(regular, 'replica.cpu_seconds')).toBeCloseTo(5, 9);
    expect(value(regular, 'replica.memory_byte_seconds')).toBeCloseTo(1024 ** 3 * 10, 0);
    expect(value(regular, 'replica.net_rx_bytes')).toBe(1e7);
    expect(value(regular, 'replica.net_tx_bytes')).toBe(5e6);

    // The next tick was skipped (a long one before it): the reading after it covers 20 s.
    advance(counters, 20);

    const late = await collector.collect(t0 + 30_000);

    expect(value(late, 'replica.cpu_seconds')).toBeCloseTo(10, 9);
    expect(value(late, 'replica.memory_byte_seconds')).toBeCloseTo(1024 ** 3 * 20, 0);
    expect(value(late, 'replica.net_rx_bytes')).toBe(2e7);
    expect(value(late, 'replica.net_tx_bytes')).toBe(1e7);
    // The instantaneous series for graphs stay rates / averages over the measured interval.
    expect(value(late, 'replica.cpu_cores')).toBeCloseTo(0.5, 9);
    expect(value(late, 'replica.net_rx_bytes_per_s')).toBeCloseTo(1e6, 6);
  });

  it('keeps the previous reading when one fails, so the next one covers the gap', async () => {
    const { collector, counters } = setup();

    await collector.collect(t0);

    const saved = counters.get('c0') as Counters;

    counters.delete('c0');
    advance(new Map([['c0', saved]]), 10);
    await collector.collect(t0 + 10_000);
    counters.set('c0', saved);
    advance(counters, 10);

    const after = await collector.collect(t0 + 20_000);

    expect(value(after, 'replica.cpu_seconds')).toBeCloseTo(10, 9);
    expect(value(after, 'replica.memory_byte_seconds')).toBeCloseTo(1024 ** 3 * 20, 0);
    expect(value(after, 'replica.net_rx_bytes')).toBe(2e7);
  });

  it('counts everything since a restart when a counter went down', async () => {
    const { collector, counters } = setup();

    await collector.collect(t0);
    advance(counters, 10);
    await collector.collect(t0 + 10_000);
    counters.set('c0', { cpuNs: 2e9, systemNs: 40e9, memory: 1024 ** 3, rx: 1000, tx: 500 });

    const restarted = await collector.collect(t0 + 20_000);

    expect(value(restarted, 'replica.cpu_seconds')).toBeCloseTo(2, 9);
    expect(value(restarted, 'replica.net_rx_bytes')).toBe(1000);
    expect(value(restarted, 'replica.net_tx_bytes')).toBe(500);
  });

  it('meters every replica of a node, more than 500 included', async () => {
    const { collector, counters } = setup(1300);

    await collector.collect(t0);
    advance(counters, 10);

    const report = await collector.collect(t0 + 10_000);
    const cpu = report.samples.filter((s) => s.metric === 'replica.cpu_seconds');

    expect(cpu).toHaveLength(1300);
    expect(value(report, 'replica.cpu_seconds', 'shop/web/api/1299')).toBeCloseTo(5, 9);
    // 1300 replicas × 8 series exceed one message: the collection goes out as protocol-sized reports.
    expect(report.samples.length).toBeGreaterThan(MAX_SAMPLES_PER_REPORT);

    const parts = splitMetricsReport(report);

    expect(parts.length).toBe(2);
    expect(parts.every((p) => p.samples.length <= MAX_SAMPLES_PER_REPORT && p.at === report.at)).toBe(true);
    expect(parts.flatMap((p) => p.samples)).toEqual(report.samples);
  });

  it('bills a replica created since the previous collection from its creation', async () => {
    const { collector, counters, containers } = setup();

    await collector.collect(t0);
    // Created 4 s before the next collection, with 1 CPU-second and 100 bytes in already.
    containers.push({
      Id: 'new',
      State: 'running',
      Created: (t0 + 6_000) / 1000,
      Labels: { 'loadweaver.com/managed': 'true', 'loadweaver.com/workload': 'shop/web/api/9' },
    });
    counters.set('new', { cpuNs: 1e9, systemNs: 16e9, memory: 1024 ** 3, rx: 100, tx: 50 });

    const report = await collector.collect(t0 + 10_000);

    expect(value(report, 'replica.cpu_seconds', 'shop/web/api/9')).toBeCloseTo(1, 9);
    expect(value(report, 'replica.memory_byte_seconds', 'shop/web/api/9')).toBeCloseTo(1024 ** 3 * 4, 0);
    expect(value(report, 'replica.net_rx_bytes', 'shop/web/api/9')).toBe(100);
    // No previous reading: no rate for graphs yet.
    expect(value(report, 'replica.cpu_cores', 'shop/web/api/9')).toBeUndefined();
  });

  it('sends a split collection in order and keeps unsent parts for later', async () => {
    let clock = t0;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 1_000));
    const { collector, counters } = setup(1300);
    const sent: number[] = [];
    let accept = true;

    collector.attach(() => {
      if (!accept) return false;

      sent.push(1);

      return true;
    });
    collector.onModuleDestroy();

    await collector.tick();
    advance(counters, 10);
    accept = false;
    await collector.tick();

    expect(sent).toHaveLength(1);

    accept = true;
    await collector.tick();

    // The first collection (1 report: no deltas yet), then the second and third (2 reports each).
    expect(sent).toHaveLength(5);
    now.mockRestore();
  });
});
