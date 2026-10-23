import { Logger } from '@nestjs/common';

import { MetricsStore, metricScope, resolution, SAFE_ENTITY, timescaleFeatures } from './metrics.store';

describe('metrics store rules (3.18)', () => {
  it('picks the resolution from the range', () => {
    const h = 3_600_000;

    expect(resolution(0, 6 * h, 6 * h)).toMatchObject({ table: 'lw_metrics', step: '10 seconds' });
    expect(resolution(0, 6 * h + 1, 6 * h + 1)).toMatchObject({ table: 'lw_metrics_1m', step: '1 minute' });
    expect(resolution(0, 30 * 24 * h, 30 * 24 * h)).toMatchObject({ table: 'lw_metrics_1h', step: '1 hour' });
  });

  it('reads coarser tables for ranges older than a table keeps', () => {
    const h = 3_600_000;
    const d = 24 * h;

    expect(resolution(20 * d, 20 * d + h, 40 * d)).toMatchObject({ table: 'lw_metrics_1m' });
    expect(resolution(20 * d, 22 * d, 80 * d)).toMatchObject({ table: 'lw_metrics_1h' });
  });

  it('scopes by access', () => {
    expect(metricScope({ isApiKey: false, clusterRole: 'auditor', projects: new Map() })).toEqual({
      all: true,
      projects: [],
    });
    expect(metricScope({ isApiKey: false, projects: new Map([['shop', 'viewer']]) })).toEqual({
      all: false,
      projects: ['shop'],
    });
  });
});

describe('SAFE_ENTITY', () => {
  it('accepts entity names nodes report and rejects markup', () => {
    for (const ok of ['node', 'eth0', 'lw0/AbC+/=12', 'shop/site/web/0', 'running', '*.example.com', 'fd00::1'])
      expect(SAFE_ENTITY.test(ok)).toBe(true);

    for (const bad of ['<img src=x onerror=alert(1)>', 'a b', '"x"', "it's", '', 'x'.repeat(256)])
      expect(SAFE_ENTITY.test(bad)).toBe(false);
  });
});

/** A database that answers MetricsStore's setup queries like TimescaleDB under `license` (null: not available). */
function fakeDatabase(license: 'apache' | 'timescale' | null) {
  const statements: string[] = [];
  const relkinds = new Map<string, string>([
    ['lw_metrics_1m', 'r'],
    ['lw_metrics_1h', 'r'],
    ['lw_flows_1h', 'r'],
  ]);
  let installed = false;
  const query = async (sql: string, params?: unknown[]): Promise<unknown[]> => {
    statements.push(sql);

    if (sql.includes('pg_available_extensions')) return license ? [{ '?column?': 1 }] : [];

    if (sql.includes('pg_try_advisory_lock')) return [{ locked: true }];

    if (sql.startsWith('CREATE EXTENSION')) installed = true;

    if (sql.includes('FROM pg_extension')) return installed ? [{ '?column?': 1 }] : [];

    if (sql.includes("current_setting('timescaledb.license'")) return [{ license }];

    if (sql.startsWith('CREATE MATERIALIZED VIEW') || sql.includes('add_continuous_aggregate_policy')) {
      if (license !== 'timescale') throw new Error('functionality not supported under the current "apache" license');

      const name = /"(lw_[a-z0-9_]+)"/.exec(sql)?.[1];

      if (name && sql.startsWith('CREATE MATERIALIZED VIEW')) relkinds.set(name, 'v');
    }

    if (sql.includes('add_retention_policy') && license !== 'timescale')
      throw new Error('functionality not supported under the current "apache" license');

    if (sql.startsWith('DROP TABLE')) relkinds.delete(/"(lw_[a-z0-9_]+)"/.exec(sql)?.[1] ?? '');

    if (sql.includes('SELECT relkind FROM pg_class')) {
      const kind = relkinds.get(String(params?.[0]));

      return kind ? [{ relkind: kind }] : [];
    }

    if (sql.includes('SELECT relname, relkind FROM pg_class'))
      return [...relkinds].map(([relname, relkind]) => ({ relname, relkind }));

    return [];
  };
  const runner = { connect: async () => undefined, release: async () => undefined, query };

  return {
    statements,
    dataSource: { query, createQueryRunner: () => runner, transaction: jest.fn() } as never,
  };
}

describe('MetricsStore setup by TimescaleDB license (3.13)', () => {
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => void logs.push(`WARN ${String(m)}`));
  });

  afterEach(() => jest.restoreAllMocks());

  it('knows which features each license has', () => {
    expect(timescaleFeatures('timescale')).toEqual({ hypertables: true, continuousAggregates: true });
    expect(timescaleFeatures('apache')).toEqual({ hypertables: true, continuousAggregates: false });
    expect(timescaleFeatures(null)).toEqual({ hypertables: false, continuousAggregates: false });
  });

  it('uses hypertables under the Apache license and keeps the roll-up tables for the control plane, without errors', async () => {
    const db = fakeDatabase('apache');
    const store = new MetricsStore(db.dataSource, {} as never);

    expect(await store.setup()).toBe(false);
    expect(store.mode).toBe('hypertables');
    expect(db.statements.filter((s) => s.includes('create_hypertable'))).toHaveLength(2);
    // Nothing TSL-only is attempted, and the roll-up tables stay (no DROP for a view that can't be created).
    expect(
      db.statements.filter((s) =>
        /MATERIALIZED VIEW|add_continuous_aggregate_policy|add_retention_policy|DROP TABLE/.test(s),
      ),
    ).toEqual([]);
    expect(db.statements.some((s) => s.startsWith('CREATE TABLE IF NOT EXISTS "lw_metrics_1m"'))).toBe(true);
    expect(logs.filter((l) => l.startsWith('WARN'))).toEqual([]);
    // Said once, not on every setup.
    await store.setup();
    expect(logs).toEqual([
      'Metrics storage: TimescaleDB (apache license), hypertables; roll-ups and retention by the control plane (continuous aggregates and policies need the community license)',
    ]);
  });

  it('turns the roll-ups into continuous aggregates with policies under the community license', async () => {
    const db = fakeDatabase('timescale');
    const store = new MetricsStore(db.dataSource, {} as never);

    expect(await store.setup()).toBe(true);
    expect(store.mode).toBe('timescaledb');
    expect(db.statements.filter((s) => s.startsWith('CREATE MATERIALIZED VIEW'))).toHaveLength(3);
    expect(db.statements.filter((s) => s.includes('add_retention_policy'))).toHaveLength(5);
    expect(logs).toEqual([
      'Metrics storage: TimescaleDB (timescale license), hypertables, continuous aggregates and retention policies',
    ]);
  });

  it('keeps plain tables without TimescaleDB', async () => {
    const db = fakeDatabase(null);
    const store = new MetricsStore(db.dataSource, {} as never);

    expect(await store.setup()).toBe(false);
    expect(store.mode).toBe('postgres');
    expect(db.statements.some((s) => s.includes('create_hypertable'))).toBe(false);
    expect(logs).toEqual(['Metrics storage: Postgres, plain tables; roll-ups and retention by the control plane']);
  });
});
