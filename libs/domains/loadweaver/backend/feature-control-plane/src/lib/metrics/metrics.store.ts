import type { RequestWithUser } from '@forepath/identity/backend';
import type { MetricsReport } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type QueryRunner } from 'typeorm';

import { canReadProject, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { databaseTarget, writesPaused } from '../database-handover/database-target.runtime';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { prometheusText } from './prometheus.utils';
import { liveTraffic } from './read-only-metrics';

const ROLLUP_MS = 60_000;
const RETENTION_MS = 3_600_000;
const ADVISORY_LOCK_METRICS = 0x4c570013;
const ADVISORY_LOCK_METRICS_ROLLUP = 0x4c570015;
const CHUNK = 1_000;
export const MAX_SERIES = 200;
export const MAX_PROMETHEUS_SERIES = 50_000;
const PROMETHEUS_CACHE_MS = 15_000;

/** Retention of each table (3.18): 10 s for 7 days, 1 min for 30 days, 1 h for 13 months; flows 30 days / 13 months. */
export const METRICS_RETENTION = {
  lw_metrics: '7 days',
  lw_metrics_1m: '30 days',
  lw_metrics_1h: '395 days',
  lw_flows: '30 days',
  lw_flows_1h: '395 days',
  lw_events: '395 days',
} as const;

/**
 * How metrics are stored (3.13): `timescaledb` = hypertables, continuous aggregates, retention policies (community
 * license); `hypertables` = TimescaleDB under the Apache license (Spilo's), roll-ups / retention by the control plane;
 * `postgres` = plain tables.
 */
export type MetricsMode = 'timescaledb' | 'hypertables' | 'postgres';

/** What a TimescaleDB license allows: continuous aggregates and job policies are community (TSL) features. */
export function timescaleFeatures(license: string | null): { hypertables: boolean; continuousAggregates: boolean } {
  return { hypertables: license !== null, continuousAggregates: license === 'timescale' };
}

export type Aggregation = 'avg' | 'min' | 'max' | 'sum';

export interface MetricQuery {
  metric: string;
  from?: string;
  to?: string;
  /** Exact entity, or a prefix ending in `*` (e.g. `shop/site/*`). */
  entity?: string;
  node?: string;
  project?: string;
  groupBy?: 'entity' | 'node' | 'project' | 'none';
  aggregation?: Aggregation;
}

export interface Series {
  key: string;
  points: [string, number][];
}

/**
 * Raw 10 s data up to 6 hours, 1-minute roll-ups up to 7 days, hourly beyond (3.18: resolution by range); a range
 * starting before a table's retention reads the next coarser one, so old short ranges aren't empty.
 */
export function resolution(
  fromMs: number,
  toMs: number,
  nowMs = Date.now(),
): { table: string; time: string; step: string } {
  const range = toMs - fromMs;
  const age = nowMs - fromMs;

  if (range <= 6 * 3_600_000 && age <= 7 * 86_400_000) return { table: 'lw_metrics', time: 'time', step: '10 seconds' };

  if (range <= 7 * 86_400_000 && age <= 30 * 86_400_000)
    return { table: 'lw_metrics_1m', time: 'bucket', step: '1 minute' };

  return { table: 'lw_metrics_1h', time: 'bucket', step: '1 hour' };
}

/** What a caller may read: everything for cluster roles, else samples of readable projects only. */
export function metricScope(caller: AccessCaller): { all: boolean; projects: string[] } {
  return {
    all: !!caller.clusterRole,
    projects: [...caller.projects.keys()].filter((p) => canReadProject(caller, p)),
  };
}

/** Characters a metric entity may have (node / interface / replica / volume names, addresses, hostnames, keys). */
export const SAFE_ENTITY = /^[A-Za-z0-9_.:/@*+=-]{1,255}$/;

/**
 * Metrics, flows and events in Postgres (3.13, 3.18). On TimescaleDB the raw tables become hypertables, and under the
 * community license the roll-ups continuous aggregates with retention policies; under the Apache license (Spilo) and
 * on plain Postgres the control plane maintains the same roll-up tables and deletes old rows itself, so queries are
 * identical either way.
 */
@Injectable()
export class MetricsStore implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MetricsStore.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private storageMode: MetricsMode | null = null;
  private readonly prometheusCache = new Map<string, { at: number; text: string }>();
  private readonly placements = new Map<string, { at: number; replicas: Set<string> }>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
  ) {}

  onApplicationBootstrap(): void {
    void this.setup().catch((error: unknown) =>
      this.logger.warn(`Metrics setup: ${error instanceof Error ? error.message : String(error)}`),
    );
    this.timers.push(
      setInterval(() => {
        if (!writesPaused('Metrics rollup', this.logger)) void this.rollup().catch(() => undefined);
      }, ROLLUP_MS),
    );
    this.timers.push(
      setInterval(() => {
        if (!writesPaused('Metrics retention', this.logger)) void this.retention().catch(() => undefined);
      }, RETENTION_MS),
    );
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearInterval(t));
  }

  /** How metrics are stored, once `setup` ran (null before). */
  get mode(): MetricsMode | null {
    return this.storageMode;
  }

  /**
   * TimescaleDB when the database has it (Spilo does): hypertables always; continuous aggregates and retention
   * policies only under the community license (Spilo ships the Apache license, where they don't exist). Whatever
   * TimescaleDB can't do, the control plane does itself (roll-ups, retention), as on plain Postgres. Returns
   * whether the roll-ups are continuous aggregates.
   */
  async setup(): Promise<boolean> {
    const available: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'`,
    );

    if (available.length === 0) return this.settle('postgres', null);

    const runner = this.dataSource.createQueryRunner();

    await runner.connect();

    try {
      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_METRICS]);

      if (!locked) {
        // Another replica sets up; wait for it, then look at what it achieved.
        await runner.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_METRICS]);
        await runner.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_METRICS]);
      } else {
        try {
          await runner.query('CREATE EXTENSION IF NOT EXISTS timescaledb');

          // Hypertables are part of the Apache-licensed core.
          for (const table of ['lw_metrics', 'lw_flows'])
            await runner.query(
              `SELECT create_hypertable('${table}', 'time', if_not_exists => TRUE, migrate_data => TRUE)`,
            );

          if (timescaleFeatures(await this.license(runner)).continuousAggregates)
            await this.createContinuousAggregates(runner);
        } catch (error) {
          // Listed but not usable (not preloaded, no privilege): the control plane maintains the roll-ups itself.
          this.logger.warn(`TimescaleDB setup failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          await runner.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_METRICS]);
        }
      }

      const license = await this.license(runner).catch(() => null);

      if (await this.aggregatesReady()) return this.settle('timescaledb', license);

      // The control plane fills the roll-up tables (they may be missing after an earlier failed conversion).
      await this.ensureRollupTables(runner);

      return this.settle(license === null ? 'postgres' : 'hypertables', license);
    } finally {
      await runner.release();
    }
  }

  /** `timescaledb.license` (`timescale` = community, `apache`), or null without the extension loaded. */
  private async license(runner: QueryRunner): Promise<string | null> {
    const installed: unknown[] = await runner.query(`SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'`);

    if (installed.length === 0) return null;

    const [row] = await runner.query(`SELECT current_setting('timescaledb.license', true) AS license`);

    return (row?.license as string | null) || null;
  }

  /** Records the mode and says once (per change) which one is active. */
  private settle(mode: MetricsMode, license: string | null): boolean {
    if (mode !== this.storageMode) {
      const how = {
        timescaledb: 'hypertables, continuous aggregates and retention policies',
        hypertables:
          'hypertables; roll-ups and retention by the control plane (continuous aggregates and policies need the community license)',
        postgres: 'plain tables; roll-ups and retention by the control plane',
      }[mode];

      this.logger.log(`Metrics storage: ${license ? `TimescaleDB (${license} license)` : 'Postgres'}, ${how}`);
    }

    this.storageMode = mode;

    return mode === 'timescaledb';
  }

  /** Community license only: the roll-ups as continuous aggregates with refresh and retention policies. */
  private async createContinuousAggregates(runner: QueryRunner): Promise<void> {
    const views: { name: string; sql: string }[] = [
      {
        name: 'lw_metrics_1m',
        sql: `SELECT time_bucket('1 minute', "time") AS bucket, metric, node, project, entity, avg(value) AS avg, min(value) AS min, max(value) AS max, count(*) AS samples FROM lw_metrics GROUP BY bucket, metric, node, project, entity`,
      },
      {
        name: 'lw_metrics_1h',
        sql: `SELECT time_bucket('1 hour', "time") AS bucket, metric, node, project, entity, avg(value) AS avg, min(value) AS min, max(value) AS max, count(*) AS samples FROM lw_metrics GROUP BY bucket, metric, node, project, entity`,
      },
      {
        name: 'lw_flows_1h',
        sql: `SELECT time_bucket('1 hour', "time") AS bucket, node, policy, src, dst, src_project, dst_project, protocol, port, decision, sum(packets) AS packets, sum(bytes) AS bytes FROM lw_flows GROUP BY bucket, node, policy, src, dst, src_project, dst_project, protocol, port, decision`,
      },
    ];

    for (const view of views) {
      const [kind] = await runner.query(`SELECT relkind FROM pg_class WHERE relname = $1`, [view.name]);

      if (kind?.relkind === 'r') await runner.query(`DROP TABLE "${view.name}"`);

      if (kind?.relkind !== 'v') {
        await runner.query(
          `CREATE MATERIALIZED VIEW "${view.name}" WITH (timescaledb.continuous) AS ${view.sql} WITH NO DATA`,
        );

        const hourly = view.name.endsWith('_1h');

        await runner.query(
          `SELECT add_continuous_aggregate_policy('${view.name}', start_offset => INTERVAL '${hourly ? '3 hours' : '10 minutes'}', end_offset => INTERVAL '${hourly ? '1 hour' : '1 minute'}', schedule_interval => INTERVAL '${hourly ? '30 minutes' : '1 minute'}', if_not_exists => TRUE)`,
        );
      }
    }

    for (const [table, interval] of Object.entries(METRICS_RETENTION).filter(([t]) => t !== 'lw_events'))
      await runner.query(`SELECT add_retention_policy('${table}', INTERVAL '${interval}', if_not_exists => TRUE)`);
  }

  /** The roll-up tables of the metrics migration, for the modes where the control plane fills them. */
  private async ensureRollupTables(runner: QueryRunner): Promise<void> {
    for (const bucket of ['1m', '1h'])
      await runner.query(
        `CREATE TABLE IF NOT EXISTS "lw_metrics_${bucket}" ("bucket" TIMESTAMPTZ NOT NULL, "metric" varchar(64) NOT NULL, "node" varchar(63) NOT NULL, "project" varchar(63), "entity" varchar(255) NOT NULL DEFAULT '', "avg" double precision NOT NULL, "min" double precision NOT NULL, "max" double precision NOT NULL, "samples" bigint NOT NULL, CONSTRAINT "PK_lw_metrics_${bucket}" PRIMARY KEY ("metric", "node", "entity", "bucket"))`,
      );

    await runner.query(
      `CREATE TABLE IF NOT EXISTS "lw_flows_1h" ("bucket" TIMESTAMPTZ NOT NULL, "node" varchar(63) NOT NULL, "policy" varchar(255) NOT NULL DEFAULT '', "src" varchar(255) NOT NULL, "dst" varchar(255) NOT NULL, "src_project" varchar(63), "dst_project" varchar(63), "protocol" varchar(8) NOT NULL, "port" integer NOT NULL DEFAULT 0, "decision" varchar(16) NOT NULL, "packets" bigint NOT NULL, "bytes" bigint NOT NULL, CONSTRAINT "PK_lw_flows_1h" PRIMARY KEY ("node", "policy", "src", "dst", "protocol", "port", "decision", "bucket"))`,
    );
  }

  /** The roll-ups are continuous aggregates (views), not tables the control plane fills. */
  private async aggregatesReady(): Promise<boolean> {
    const rows: { relname: string; relkind: string }[] = await this.dataSource.query(
      `SELECT relname, relkind FROM pg_class WHERE relname = ANY($1)`,
      [['lw_metrics_1m', 'lw_metrics_1h', 'lw_flows_1h']],
    );

    return rows.length === 3 && rows.every((r) => r.relkind === 'v');
  }

  /**
   * Plain Postgres: the roll-ups the continuous aggregates would maintain (idempotent upserts), by one replica at a
   * time. Minutes from the raw data (15 minutes back, for late reports of reconnecting nodes), hours from the minutes
   * (weighted by their sample counts).
   */
  async rollup(): Promise<void> {
    if (this.storageMode === null || this.storageMode === 'timescaledb') return;

    await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_METRICS_ROLLUP,
      ]);

      if (!locked) return;

      await manager.query(
        `INSERT INTO lw_metrics_1m (bucket, metric, node, project, entity, avg, min, max, samples)
         SELECT date_trunc('minute', "time"), metric, node, max(project), entity, avg(value), min(value), max(value), count(*)
         FROM lw_metrics WHERE "time" >= date_trunc('minute', now()) - INTERVAL '15 minutes' AND "time" < date_trunc('minute', now())
         GROUP BY 1, metric, node, entity
         ON CONFLICT (metric, node, entity, bucket) DO UPDATE SET avg = EXCLUDED.avg, min = EXCLUDED.min, max = EXCLUDED.max, samples = EXCLUDED.samples, project = EXCLUDED.project`,
      );
      await manager.query(
        `INSERT INTO lw_metrics_1h (bucket, metric, node, project, entity, avg, min, max, samples)
         SELECT date_trunc('hour', bucket), metric, node, max(project), entity, sum(avg * samples) / sum(samples), min(min), max(max), sum(samples)
         FROM lw_metrics_1m WHERE bucket >= date_trunc('hour', now()) - INTERVAL '1 hour'
         GROUP BY 1, metric, node, entity
         ON CONFLICT (metric, node, entity, bucket) DO UPDATE SET avg = EXCLUDED.avg, min = EXCLUDED.min, max = EXCLUDED.max, samples = EXCLUDED.samples, project = EXCLUDED.project`,
      );
      await manager.query(
        `INSERT INTO lw_flows_1h (bucket, node, policy, src, dst, src_project, dst_project, protocol, port, decision, packets, bytes)
         SELECT date_trunc('hour', "time"), node, policy, src, dst, max(src_project), max(dst_project), protocol, port, decision, sum(packets), sum(bytes)
         FROM lw_flows WHERE "time" >= date_trunc('hour', now()) - INTERVAL '1 hour'
         GROUP BY 1, node, policy, src, dst, protocol, port, decision
         ON CONFLICT (node, policy, src, dst, protocol, port, decision, bucket) DO UPDATE SET packets = EXCLUDED.packets, bytes = EXCLUDED.bytes`,
      );
    });
  }

  /** Plain Postgres deletes old rows itself; on TimescaleDB the retention policies drop chunks (events always here). */
  async retention(): Promise<void> {
    const tables = this.storageMode === 'timescaledb' ? ['lw_events'] : Object.keys(METRICS_RETENTION);

    for (const table of tables) {
      const column = table.endsWith('_1m') || table.endsWith('_1h') ? 'bucket' : 'time';
      const interval = METRICS_RETENTION[table as keyof typeof METRICS_RETENTION];

      await this.dataSource.query(`DELETE FROM "${table}" WHERE "${column}" < now() - INTERVAL '${interval}'`);
    }
  }

  private async replicasOn(node: string): Promise<Set<string>> {
    const cached = this.placements.get(node);

    if (cached && Date.now() - cached.at < 10_000) return cached.replicas;

    const rows = await this.dataSource
      .getRepository(WorkloadPlacementEntity)
      .find({ where: [{ node }, { targetNode: node }], select: { id: true } });
    const replicas = new Set(rows.map((r) => r.id));

    this.placements.set(node, { at: Date.now(), replicas });

    return replicas;
  }

  /** A node's report: replica samples only for replicas it runs (with their project), everything else node-level. */
  async ingest(nodeName: string, report: MetricsReport): Promise<{ samples: number; rejected: number }> {
    const at = new Date(report.at);
    const time = Number.isNaN(at.getTime()) || Math.abs(Date.now() - at.getTime()) > 3_600_000 ? new Date() : at;

    // Read-only fallback (3.43): nothing can be stored; the overview's traffic numbers stay live from memory.
    if (databaseTarget.fallback) {
      const samples = report.samples.filter((s) => SAFE_ENTITY.test(s.entity));

      liveTraffic.record(nodeName, { samples, flows: report.flows }, Date.now());

      return { samples: 0, rejected: report.samples.length - samples.length };
    }

    const replicas = await this.replicasOn(nodeName);
    const rows: unknown[][] = [];
    let rejected = 0;

    for (const s of report.samples) {
      // Entities end up as series names in charts: names, ids, addresses, hostnames and base64 keys only.
      if (!SAFE_ENTITY.test(s.entity)) {
        rejected++;
        continue;
      }

      if (s.metric.startsWith('replica.')) {
        if (!replicas.has(s.entity)) {
          rejected++;
          continue;
        }

        rows.push([time, s.metric, nodeName, s.entity.split('/')[0], s.entity, s.value]);
      } else rows.push([time, s.metric, nodeName, null, s.entity, s.value]);
    }

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);

      await this.dataSource.query(
        `INSERT INTO lw_metrics ("time", metric, node, project, entity, value) VALUES ${chunk.map((_, j) => `($${j * 6 + 1}, $${j * 6 + 2}, $${j * 6 + 3}, $${j * 6 + 4}, $${j * 6 + 5}, $${j * 6 + 6})`).join(', ')}`,
        chunk.flat(),
      );
    }

    const flows = report.flows.map((f) => [
      time,
      nodeName,
      f.policy,
      f.src,
      f.dst,
      f.protocol,
      f.port,
      f.decision,
      f.packets,
      f.bytes,
    ]);

    for (let i = 0; i < flows.length; i += CHUNK) {
      const chunk = flows.slice(i, i + CHUNK);

      await this.dataSource.query(
        `INSERT INTO lw_flows ("time", node, policy, src, dst, protocol, port, decision, packets, bytes) VALUES ${chunk.map((_, j) => `(${Array.from({ length: 10 }, (__, k) => `$${j * 10 + k + 1}`).join(', ')})`).join(', ')}`,
        chunk.flat(),
      );
    }

    return { samples: rows.length, rejected };
  }

  /** Series of one metric over a range, at the resolution the range calls for, scoped by access. */
  async query(req: RequestWithUser | undefined, q: MetricQuery): Promise<{ step: string; series: Series[] }> {
    const scope = metricScope(await this.access.caller(req));

    if (q.project && !scope.all && !scope.projects.includes(q.project))
      throw new NotFoundException('project not found');

    if (!scope.all && scope.projects.length === 0) throw new NotFoundException('no metrics visible');

    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 3_600_000);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to)
      throw new BadRequestException('invalid time range');

    const { table, time, step } = resolution(from.getTime(), to.getTime());
    const aggregation = q.aggregation ?? 'avg';
    // Roll-ups: sums from avg × samples, averages weighted by their sample counts.
    const expr =
      table === 'lw_metrics'
        ? `${aggregation}(value)`
        : aggregation === 'sum'
          ? 'sum(avg * samples)'
          : aggregation === 'avg'
            ? 'sum(avg * samples) / nullif(sum(samples), 0)'
            : `${aggregation}(${aggregation})`;
    const group = q.groupBy ?? 'entity';
    const key = group === 'none' ? `'all'` : group === 'project' ? `coalesce(project, '')` : group;
    const params: unknown[] = [q.metric, from, to];
    const where = [`metric = $1`, `"${time}" >= $2`, `"${time}" < $3`];

    if (q.entity) {
      params.push(q.entity.endsWith('*') ? `${q.entity.slice(0, -1).replace(/[%_\\]/g, '\\$&')}%` : q.entity);
      where.push(q.entity.endsWith('*') ? `entity LIKE $${params.length}` : `entity = $${params.length}`);
    }

    if (q.node) {
      params.push(q.node);
      where.push(`node = $${params.length}`);
    }

    if (q.project) {
      params.push(q.project);
      where.push(`project = $${params.length}`);
    }

    if (!scope.all) {
      params.push(scope.projects);
      where.push(`project = ANY($${params.length})`);
    }

    const rows: { key: string; t: Date; v: number }[] = await this.dataSource.query(
      `SELECT ${key} AS key, date_bin('${step}', "${time}", TIMESTAMPTZ '2000-01-01') AS t, ${expr} AS v
       FROM "${table}" WHERE ${where.join(' AND ')}
       GROUP BY 1, 2 ORDER BY 1, 2 LIMIT 100000`,
      params,
    );
    const series = new Map<string, Series>();

    for (const row of rows) {
      const s = series.get(row.key) ?? { key: row.key, points: [] };

      if (!series.has(row.key) && series.size >= MAX_SERIES) continue;

      s.points.push([new Date(row.t).toISOString(), Number(row.v)]);
      series.set(row.key, s);
    }

    return { step, series: [...series.values()] };
  }

  /**
   * Prometheus scraping per caller (3.18, exports respect project access): the latest sample of every series seen in
   * the last 2 minutes, of the projects the caller may read (cluster roles: everything).
   */
  async prometheus(req: RequestWithUser | undefined, project?: string): Promise<string> {
    const scope = metricScope(await this.access.caller(req));

    if (project && !scope.all && !scope.projects.includes(project)) throw new NotFoundException('project not found');

    if (!scope.all && scope.projects.length === 0) throw new NotFoundException('no metrics visible');

    // Scrapers poll: one answer per scope for 15 s, so many tokens can't keep the database busy.
    const cacheKey = JSON.stringify([scope.all ? '*' : [...scope.projects].sort(), project ?? '']);
    const cached = this.prometheusCache.get(cacheKey);

    if (cached && Date.now() - cached.at < PROMETHEUS_CACHE_MS) return cached.text;

    const params: unknown[] = [];
    const where = [`"time" >= now() - INTERVAL '2 minutes'`];

    if (project) {
      params.push(project);
      where.push(`project = $${params.length}`);
    }

    if (!scope.all) {
      params.push(scope.projects);
      where.push(`project = ANY($${params.length})`);
    }

    const rows: { metric: string; node: string; entity: string; project: string | null; value: number; time: Date }[] =
      await this.dataSource.query(
        `SELECT DISTINCT ON (metric, node, entity) metric, node, entity, project, value, "time"
         FROM lw_metrics WHERE ${where.join(' AND ')}
         ORDER BY metric, node, entity, "time" DESC LIMIT ${MAX_PROMETHEUS_SERIES}`,
        params,
      );

    const text = prometheusText(rows.map((r) => ({ ...r, value: Number(r.value), time: new Date(r.time) })));

    if (this.prometheusCache.size > 1_000) this.prometheusCache.clear();

    this.prometheusCache.set(cacheKey, { at: Date.now(), text });

    return text;
  }

  /** Metric names with samples in the last hour that the caller can read (query builders, Grafana search). */
  async metricNames(req: RequestWithUser | undefined): Promise<string[]> {
    const scope = metricScope(await this.access.caller(req));

    if (!scope.all && scope.projects.length === 0) return [];

    const rows: { metric: string }[] = await this.dataSource.query(
      `SELECT DISTINCT metric FROM lw_metrics WHERE "time" >= now() - INTERVAL '1 hour'
       ${scope.all ? '' : 'AND project = ANY($1)'} ORDER BY metric LIMIT 1000`,
      scope.all ? [] : [scope.projects],
    );

    return rows.map((r) => r.metric);
  }

  /** Top flows over a range (3.18 traffic decisions): per policy edge and decision. Cluster roles only for now. */
  async flows(
    req: RequestWithUser | undefined,
    q: {
      from?: string;
      to?: string;
      decision?: 'allowed' | 'denied' | 'observed';
      node?: string;
      policy?: string;
      limit?: number;
    },
  ): Promise<
    {
      policy: string;
      src: string;
      dst: string;
      protocol: string;
      port: number;
      decision: string;
      packets: number;
      bytes: number;
    }[]
  > {
    if (!metricScope(await this.access.caller(req)).all) throw new NotFoundException('no flows visible');

    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 3_600_000);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException('invalid time range');

    const table =
      to.getTime() - from.getTime() <= 7 * 86_400_000 && Date.now() - from.getTime() <= 30 * 86_400_000
        ? 'lw_flows'
        : 'lw_flows_1h';
    const time = table === 'lw_flows' ? 'time' : 'bucket';
    const params: unknown[] = [from, to];
    const where = [`"${time}" >= $1`, `"${time}" < $2`];

    for (const [column, v] of [
      ['decision', q.decision],
      ['node', q.node],
      ['policy', q.policy],
    ] as const)
      if (v) {
        params.push(v);
        where.push(`${column} = $${params.length}`);
      }

    params.push(Math.min(Math.max(q.limit ?? 50, 1), 500));

    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT policy, src, dst, protocol, port, decision, sum(packets)::bigint AS packets, sum(bytes)::bigint AS bytes
       FROM "${table}" WHERE ${where.join(' AND ')}
       GROUP BY policy, src, dst, protocol, port, decision ORDER BY packets DESC LIMIT $${params.length}`,
      params,
    );

    return rows.map((r) => ({
      policy: String(r['policy']),
      src: String(r['src']),
      dst: String(r['dst']),
      protocol: String(r['protocol']),
      port: Number(r['port']),
      decision: String(r['decision']),
      packets: Number(r['packets']),
      bytes: Number(r['bytes']),
    }));
  }

  /** An event marker (3.18): applies, failovers, migrations, node join / leave, renewals, health changes. */
  async event(
    kind: string,
    message: string,
    options: { entity?: string; project?: string; data?: Record<string, unknown> } = {},
  ): Promise<void> {
    await this.dataSource
      .query(`INSERT INTO lw_events (kind, entity, project, message, data) VALUES ($1, $2, $3, $4, $5)`, [
        kind.slice(0, 64),
        (options.entity ?? '').slice(0, 255),
        options.project ?? null,
        message.slice(0, 4000),
        JSON.stringify(options.data ?? {}),
      ])
      .catch((error: unknown) => this.logger.debug(`Event not stored: ${String(error)}`));
  }

  async events(
    req: RequestWithUser | undefined,
    q: { from?: string; to?: string; kind?: string; project?: string; limit?: number },
  ): Promise<{ id: string; time: string; kind: string; entity: string; project: string | null; message: string }[]> {
    return await this.eventsFor(await this.access.caller(req), q);
  }

  async eventsFor(
    caller: AccessCaller,
    q: { from?: string; to?: string; kind?: string; project?: string; limit?: number },
  ): Promise<{ id: string; time: string; kind: string; entity: string; project: string | null; message: string }[]> {
    const scope = metricScope(caller);

    if (q.project && !scope.all && !scope.projects.includes(q.project))
      throw new NotFoundException('project not found');

    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 86_400_000);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException('invalid time range');

    const params: unknown[] = [from, to];
    const where = [`"time" >= $1`, `"time" < $2`];

    if (q.kind) {
      params.push(q.kind);
      where.push(`kind = $${params.length}`);
    }

    if (q.project) {
      params.push(q.project);
      where.push(`project = $${params.length}`);
    }

    if (!scope.all) {
      params.push(scope.projects);
      where.push(`project = ANY($${params.length})`);
    }

    params.push(Math.min(Math.max(q.limit ?? 200, 1), 1000));

    const rows: { id: string; time: Date; kind: string; entity: string; project: string | null; message: string }[] =
      await this.dataSource.query(
        `SELECT id, "time", kind, entity, project, message FROM lw_events WHERE ${where.join(' AND ')} ORDER BY "time" DESC LIMIT $${params.length}`,
        params,
      );

    return rows.map((r) => ({ ...r, time: new Date(r.time).toISOString() }));
  }
}
