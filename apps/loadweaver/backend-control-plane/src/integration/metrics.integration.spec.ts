import { execFileSync } from 'node:child_process';

import type { RequestWithUser } from '@forepath/identity/backend';
import { parseCompose } from '@forepath/loadweaver/shared/util-compose';
import {
  MetricsStore,
  ResourceEntity,
  SloService,
  WorkloadPlacementEntity,
} from '@forepath/loadweaver/backend/feature-control-plane';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { CreateMetrics1800000000019 } from '../migrations/1800000000019_CreateMetrics';

/**
 * Metrics on a real TimescaleDB (3.13, 3.18), as on Spilo: the raw tables become hypertables, the roll-ups continuous
 * aggregates with retention policies; samples land, and a long range is answered from the 1-minute aggregate. Then the
 * same under the Apache license (Spilo's).
 */

const TIMESCALE =
  'docker.io/timescale/timescaledb:2.30.2-pg17@sha256:b346edcdb51a1fd6020e3965e0bd1c9f3406fa6d5fbce1e28f4852587ef934e2';

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A TimescaleDB lab database with the metrics tables (and what replica verification / SLOs read). */
async function labDatabase(name: string, port: number, postgresArgs: string[]): Promise<DataSource> {
  docker([
    'run',
    '-d',
    '--name',
    name,
    '-p',
    `127.0.0.1:${port}:5432`,
    '-e',
    'POSTGRES_PASSWORD=lab',
    TIMESCALE,
    ...postgresArgs,
  ]);

  const dataSource = new DataSource({
    type: 'postgres',
    host: '127.0.0.1',
    port,
    username: 'postgres',
    password: 'lab',
    database: 'postgres',
    entities: [WorkloadPlacementEntity, ResourceEntity],
  });

  for (let i = 0; i < 60; i++) {
    try {
      await dataSource.initialize();
      await dataSource.query('SELECT 1');
      break;
    } catch {
      if (dataSource.isInitialized) await dataSource.destroy();

      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  await dataSource.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  // Only what replica verification reads.
  await dataSource.query(
    `CREATE TABLE lw_workload_placements (id varchar PRIMARY KEY, node varchar, target_node varchar)`,
  );
  await dataSource.query(`INSERT INTO lw_workload_placements VALUES ('shop/site/web/0', 'n1', NULL)`);
  // Only what the SLO service lists (the planner is stubbed).
  await dataSource.query(
    `CREATE TABLE lw_resources (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), kind varchar, project varchar, project_key varchar DEFAULT '', name varchar, labels jsonb DEFAULT '{}', annotations jsonb DEFAULT '{}', spec jsonb, generation int DEFAULT 1, updated_by varchar, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`,
  );

  const runner = dataSource.createQueryRunner();

  await new CreateMetrics1800000000019().up(runner);
  await runner.release();

  return dataSource;
}

describe('metrics on TimescaleDB (lab)', () => {
  const name = `lw-metrics-lab-${process.pid}-${Date.now()}`;
  const port = 25432 + (process.pid % 500);
  let dataSource: DataSource;
  let store: MetricsStore;
  let callers: Map<string, unknown>;
  const admin = { who: 'admin' } as unknown as RequestWithUser;
  const dev = { who: 'dev' } as unknown as RequestWithUser;

  beforeAll(async () => {
    dataSource = await labDatabase(name, port, []);
    callers = new Map<string, unknown>([
      ['admin', { isApiKey: true, clusterRole: 'cluster-admin', projects: new Map() }],
      ['dev', { userId: 'dev', isApiKey: false, projects: new Map([['shop', 'viewer']]) }],
    ]);

    store = new MetricsStore(dataSource, { caller: async (req: { who: string }) => callers.get(req.who) } as never);
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();

    try {
      docker(['rm', '-f', name]);
    } catch {
      // gone
    }
  });

  it('sets up hypertables, continuous aggregates and retention policies', async () => {
    expect(await store.setup()).toBe(true);

    const hypertables = (
      await dataSource.query(`SELECT hypertable_name FROM timescaledb_information.hypertables ORDER BY 1`)
    ).map((r: { hypertable_name: string }) => r.hypertable_name);

    expect(hypertables).toEqual(expect.arrayContaining(['lw_flows', 'lw_metrics']));
    expect(
      (await dataSource.query(`SELECT view_name FROM timescaledb_information.continuous_aggregates ORDER BY 1`)).map(
        (r: { view_name: string }) => r.view_name,
      ),
    ).toEqual(['lw_flows_1h', 'lw_metrics_1h', 'lw_metrics_1m']);
    expect(
      (
        await dataSource.query(
          `SELECT count(*)::int AS n FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention'`,
        )
      )[0].n,
    ).toBe(5);
    // Idempotent on restart.
    expect(await store.setup()).toBe(true);
  }, 120_000);

  it('stores node reports and answers short and long ranges, scoped by access', async () => {
    const at = new Date(Date.now() - 3 * 60_000).toISOString();

    expect(
      await store.ingest('n1', {
        at,
        samples: [
          { metric: 'node.cpu_cores', entity: 'node', value: 1.5 },
          { metric: 'replica.cpu_cores', entity: 'shop/site/web/0', project: 'shop', value: 0.25 },
          // Not on n1.
          { metric: 'replica.cpu_cores', entity: 'bank/core/api/0', project: 'bank', value: 9 },
        ],
        flows: [
          {
            policy: 'shop/web-api',
            src: 'lw_00000001',
            dst: 'lw_00000002',
            protocol: 'tcp',
            port: 8080,
            decision: 'allowed',
            packets: 12,
            bytes: 3400,
          },
        ],
      }),
    ).toEqual({ samples: 2, rejected: 1 });

    const short = await store.query(admin, { metric: 'replica.cpu_cores' });

    expect(short.step).toBe('10 seconds');
    expect(short.series.map((s) => s.key)).toEqual(['shop/site/web/0']);

    await dataSource.query(`CALL refresh_continuous_aggregate('lw_metrics_1m', NULL, NULL)`);

    const long = await store.query(admin, {
      metric: 'node.cpu_cores',
      from: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });

    expect(long.step).toBe('1 minute');
    expect(long.series[0]?.points[0]?.[1]).toBe(1.5);
    // Project viewers see their replicas, never node metrics.
    expect((await store.query(dev, { metric: 'replica.cpu_cores' })).series).toHaveLength(1);
    expect((await store.query(dev, { metric: 'node.cpu_cores' })).series).toEqual([]);
    expect(await store.flows(admin, {})).toEqual([
      expect.objectContaining({ policy: 'shop/web-api', decision: 'allowed', packets: 12, bytes: 3400 }),
    ]);
  }, 120_000);

  it('measures SLOs at the ingress: availability from rates, latency minutes, budget, burn and monthly uptime', async () => {
    const parsed = parseCompose(
      `services:
  web:
    image: nginx:1.27
    x-loadweaver:
      exposure: { http: [{ host: shop.example.com, port: 80 }] }
      slo: { availability: 99, latency: { thresholdMs: 200, target: 90 } }
`,
      { name: 'site', project: 'shop', defaultRequests: { cpuMillis: 100, memoryBytes: 64 * 1024 ** 2 } },
    );

    if (!parsed.ok) throw new Error('compose');

    const slos = new SloService(
      dataSource,
      { caller: async (req: { who: string }) => callers.get(req.who) } as never,
      {
        parse: () => ({ parsed: [{ project: 'shop', name: 'site', compose: parsed.deployment }], issues: [] }),
      } as never,
    );
    // Two ingress nodes, 30 minutes of traffic two hours ago: 10 req/s each, 0.5 errors/s on one; latency over the
    // threshold in 3 of the 30 minutes. The last hour: 5 % errors (fast burn against a 1 % budget).
    const rows: string[] = [];

    for (let m = 0; m < 30; m++)
      for (let s = 0; s < 6; s++) {
        const t = `now() - INTERVAL '2 hours' + INTERVAL '${m} minutes' + INTERVAL '${s * 10} seconds'`;

        for (const node of ['n1', 'n2']) {
          rows.push(`(${t}, 'ingress.requests_per_s', '${node}', 'shop.example.com', 10)`);
          rows.push(`(${t}, 'ingress.errors_per_s', '${node}', 'shop.example.com', ${node === 'n1' ? 0.05 : 0})`);
          rows.push(`(${t}, 'ingress.latency_p95_ms', '${node}', 'shop.example.com', ${m < 3 ? 500 : 50})`);
        }
      }

    for (let s = 0; s < 6; s++) {
      rows.push(`(now() - INTERVAL '${s * 10 + 5} seconds', 'ingress.requests_per_s', 'n1', 'shop.example.com', 20)`);
      rows.push(`(now() - INTERVAL '${s * 10 + 5} seconds', 'ingress.errors_per_s', 'n1', 'shop.example.com', 1)`);
    }

    await dataSource.query(`INSERT INTO lw_metrics ("time", metric, node, entity, value) VALUES ${rows.join(', ')}`);
    await dataSource.query(`CALL refresh_continuous_aggregate('lw_metrics_1m', NULL, NULL)`);
    await dataSource.query(`CALL refresh_continuous_aggregate('lw_metrics_1h', NULL, NULL)`);

    const [slo] = await slos.list(admin);

    expect(slo).toMatchObject({
      project: 'shop',
      deployment: 'site',
      service: 'web',
      hosts: ['shop.example.com'],
      window: '30d',
    });
    // 36,000 requests with 90 errors two hours ago (+ up to 1,200 with 60 errors in the current hour once rolled up).
    expect(slo.availability?.sli).toBeGreaterThan(99.55);
    expect(slo.availability?.sli).toBeLessThan(99.76);
    expect(slo.availability?.burnRate1h).toBeGreaterThanOrEqual(4.9);
    expect(slo.latency).toMatchObject({ percentile: 'p95', thresholdMs: 200 });
    // 3 slow minutes of 30, not aligned to minute buckets (up to 4 of 31).
    expect(slo.latency?.sli).toBeGreaterThan(86);
    expect(slo.latency?.sli).toBeLessThan(91);
    expect(slo.monthlyUptime === null || slo.monthlyUptime > 99).toBe(true);
    // Project viewers see their project's SLOs; others nothing.
    expect(await slos.list(dev)).toHaveLength(1);
  }, 120_000);
});

/**
 * Spilo runs TimescaleDB under the Apache license: hypertables only (continuous aggregates and policies are community
 * features). The store keeps the roll-up tables, fills them and applies retention itself, without errors.
 */
describe('metrics on TimescaleDB under the Apache license (lab)', () => {
  const name = `lw-metrics-lab-apache-${process.pid}-${Date.now()}`;
  const port = 26432 + (process.pid % 500);
  let dataSource: DataSource;
  let store: MetricsStore;
  const admin = { who: 'admin' } as unknown as RequestWithUser;

  beforeAll(async () => {
    dataSource = await labDatabase(name, port, ['-c', 'timescaledb.license=apache']);
    store = new MetricsStore(dataSource, {
      caller: async () => ({ isApiKey: true, clusterRole: 'cluster-admin', projects: new Map() }),
    } as never);
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();

    try {
      docker(['rm', '-f', name]);
    } catch {
      // gone
    }
  });

  it('uses hypertables, keeps the roll-ups as tables and maintains them itself', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');

    expect((await dataSource.query(`SELECT current_setting('timescaledb.license') AS l`))[0].l).toBe('apache');
    expect(await store.setup()).toBe(false);
    expect(store.mode).toBe('hypertables');
    expect(
      (await dataSource.query(`SELECT hypertable_name FROM timescaledb_information.hypertables ORDER BY 1`)).map(
        (r: { hypertable_name: string }) => r.hypertable_name,
      ),
    ).toEqual(['lw_flows', 'lw_metrics']);
    expect(
      (
        await dataSource.query(
          `SELECT relname, relkind FROM pg_class WHERE relname IN ('lw_metrics_1m', 'lw_metrics_1h', 'lw_flows_1h') ORDER BY 1`,
        )
      ).map((r: { relname: string; relkind: string }) => `${r.relname}:${r.relkind}`),
    ).toEqual(['lw_flows_1h:r', 'lw_metrics_1h:r', 'lw_metrics_1m:r']);
    // Idempotent on restart.
    expect(await store.setup()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    await store.ingest('n1', {
      at: new Date(Date.now() - 3 * 60_000).toISOString(),
      samples: [{ metric: 'node.cpu_cores', entity: 'node', value: 1.5 }],
      flows: [],
    });
    // Old rows the retention removes (raw data older than 7 days).
    await dataSource.query(
      `INSERT INTO lw_metrics ("time", metric, node, entity, value) VALUES (now() - INTERVAL '8 days', 'node.cpu_cores', 'n1', 'node', 9)`,
    );
    await store.rollup();
    await store.retention();

    const long = await store.query(admin, {
      metric: 'node.cpu_cores',
      from: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });

    expect(long.step).toBe('1 minute');
    expect(long.series[0]?.points.map((p) => p[1])).toEqual([1.5]);
    expect((await dataSource.query(`SELECT count(*)::int AS n FROM lw_metrics`))[0].n).toBe(1);
  }, 120_000);
});
