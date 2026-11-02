import type { RequestWithUser } from '@forepath/identity/backend';
import {
  ForbiddenException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ProjectAccessService } from '../access/project-access.service';
import { ClusterEntity } from '../entities/cluster.entity';
import {
  ALLOCATION_SAMPLE_MINUTES,
  USAGE_MAX_ROWS,
  USAGE_METER_DEFINITIONS,
  USAGE_RECOMPUTE_HOURS,
  USAGE_RETENTION,
  USAGE_SAMPLE_RETENTION,
  USAGE_SETTLE_MS,
  type UsageGranularity,
  type UsageMeter,
} from './usage.constants';
import {
  PROJECT_EGRESS_OWNER,
  resolveUsageRange,
  roundUsage,
  usageIdempotencyKey,
  usageMeterCatalog,
  type UsageRangeQuery,
  type UsageReport,
  type UsageRow,
} from './usage.utils';
import { writesPaused } from '../database-handover/database-target.runtime';

const ADVISORY_LOCK_USAGE_ROLLUP = 0x4c570046;
const SAMPLE_TICK_MS = 60_000;
const ROLLUP_TICK_MS = 5 * 60_000;
const RETENTION_TICK_MS = 3_600_000;

export interface UsageQuery extends UsageRangeQuery {
  meter?: UsageMeter;
  /** Only buckets that no longer change (what billing consumes). */
  finalOnly?: boolean;
}

export interface ClusterUsageQuery extends UsageQuery {
  project?: string;
  /** Only buckets of projects mapped to this Decabill subscription (at the time the bucket was computed). */
  billingSubscription?: string;
}

/** End of the bucket that starts at `bucket` (UTC). */
function bucketEnd(bucket: Date, granularity: UsageGranularity): Date {
  const end = new Date(bucket.getTime());

  if (granularity === 'hour') end.setUTCHours(end.getUTCHours() + 1);
  else if (granularity === 'day') end.setUTCDate(end.getUTCDate() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);

  return end;
}

/**
 * Usage metering per project (3.24). Inputs: the 1-minute roll-up of the replica metrics (CPU, memory, network; a
 * continuous aggregate under the TimescaleDB community license, else maintained by the control plane) and the control
 * plane's own allocation samples every 5 minutes (volumes, public addresses). Output: hourly buckets in `lw_usage_1h`,
 * recomputed until they are final (15 minutes after the hour) and never changed afterwards, so exports and Decabill
 * see the same numbers. A separate table instead of another continuous aggregate because billing records must be
 * immutable once final and outlive the metric retention (25 months).
 */
@Injectable()
export class UsageService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(UsageService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private clusterId: string | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
  ) {}

  onApplicationBootstrap(): void {
    const run = (name: string, job: () => Promise<unknown>) => () => {
      if (writesPaused(`Usage ${name}`, this.logger)) return;

      void job().catch((error: unknown) =>
        this.logger.warn(`Usage ${name}: ${error instanceof Error ? error.message : String(error)}`),
      );
    };

    this.timers.push(
      setInterval(
        run('sample', () => this.sample()),
        SAMPLE_TICK_MS,
      ),
    );
    this.timers.push(
      setInterval(
        run('rollup', () => this.rollup()),
        ROLLUP_TICK_MS,
      ),
    );
    this.timers.push(
      setInterval(
        run('retention', () => this.retention()),
        RETENTION_TICK_MS,
      ),
    );
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearInterval(t));
  }

  /**
   * Allocation samples (volumes, public addresses), one per project, quantity and 5-minute slot: every replica tries
   * every minute, the first insert of a slot wins (a missed minute doesn't lose the slot).
   */
  async sample(now = new Date()): Promise<void> {
    const slot = new Date(
      Math.floor(now.getTime() / (ALLOCATION_SAMPLE_MINUTES * 60_000)) * ALLOCATION_SAMPLE_MINUTES * 60_000,
    );

    await this.dataSource.query(
      `INSERT INTO lw_usage_samples ("time", project, input, value)
       SELECT $1::timestamptz, project, input, value FROM (
         SELECT split_part(id, '/', 1) AS project, 'storage_gib' AS input, sum(size_bytes::float8) / 1073741824 AS value
         FROM lw_volume_placements GROUP BY 1
         UNION ALL
         SELECT split_part(id, '/', 1), 'storage_replica_gib',
                sum(size_bytes::float8 * (1 + jsonb_array_length(sync_replicas) + jsonb_array_length(remote_replicas))) / 1073741824
         FROM lw_volume_placements GROUP BY 1
         UNION ALL
         SELECT substring(owner from $2::text), 'public_ips', count(*)::float8
         FROM lw_public_addresses WHERE state = 'assigned' AND owner ~ $2::text GROUP BY 1
       ) s WHERE value > 0 AND project <> ''
       ON CONFLICT ("time", project, input) DO NOTHING`,
      [slot, PROJECT_EGRESS_OWNER],
    );
  }

  /**
   * Recomputes the hourly buckets of the last hours that aren't final yet (one replica at a time), snapshots each
   * project's Decabill mapping into them, and marks buckets final once they are past the settle time.
   */
  async rollup(now = new Date()): Promise<void> {
    const since = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000 - USAGE_RECOMPUTE_HOURS * 3_600_000);
    const replica = USAGE_METER_DEFINITIONS.filter((m) => m.source === 'replica');
    const allocation = USAGE_METER_DEFINITIONS.filter((m) => m.source === 'allocation');

    await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_USAGE_ROLLUP,
      ]);

      if (!locked) return;

      // Replica meters integrate the measured time: the agent's integrated samples (CPU-seconds, byte-seconds, byte
      // deltas) are summed as they are. A replica minute without them (an N-1 agent) falls back to its instantaneous
      // samples × the nominal 10 s.
      await manager.query(
        `WITH replica AS (
           SELECT date_trunc('hour', m.bucket AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bucket, m.project, d.meter,
                  sum(m.avg * m.samples * CASE WHEN m.metric = d.input THEN d.factor ELSE d.legacy_factor END) AS value
           FROM lw_metrics_1m m
           JOIN unnest($2::text[], $3::text[], $4::float8[], $10::text[], $11::float8[]) AS d(input, meter, factor, legacy, legacy_factor)
             ON m.metric = d.input
             OR (m.metric = d.legacy AND NOT EXISTS (
                   SELECT 1 FROM lw_metrics_1m i
                   WHERE i.metric = d.input AND i.node = m.node AND i.entity = m.entity AND i.bucket = m.bucket))
           WHERE m.bucket >= $1 AND m.bucket < $9 AND m.project IS NOT NULL
           GROUP BY 1, 2, d.meter
         ), allocation AS (
           SELECT date_trunc('hour', s."time" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bucket, s.project, d.meter, sum(s.value) * d.factor AS value
           FROM lw_usage_samples s
           JOIN unnest($5::text[], $6::text[], $7::float8[]) AS d(input, meter, factor) ON d.input = s.input
           WHERE s."time" >= $1 AND s."time" < $9
           GROUP BY 1, 2, d.meter, d.factor
         ), mapping AS (
           SELECT name AS project, spec->'billing'->>'decabillSubscriptionId' AS subscription
           FROM lw_resources WHERE kind = 'Project'
         )
         INSERT INTO lw_usage_1h (bucket, project, meter, value, final, billing_subscription, updated_at)
         SELECT c.bucket, c.project, c.meter, c.value, c.bucket + INTERVAL '1 hour' + $8::interval <= $9, mapping.subscription, $9
         FROM (SELECT * FROM replica UNION ALL SELECT * FROM allocation) c
         LEFT JOIN mapping ON mapping.project = c.project
         ON CONFLICT (project, meter, bucket) DO UPDATE SET value = EXCLUDED.value, final = EXCLUDED.final,
           billing_subscription = EXCLUDED.billing_subscription, updated_at = EXCLUDED.updated_at
         WHERE NOT lw_usage_1h.final`,
        [
          since,
          replica.map((m) => m.input),
          replica.map((m) => m.key),
          replica.map((m) => m.factor),
          allocation.map((m) => m.input),
          allocation.map((m) => m.key),
          allocation.map((m) => m.factor),
          `${USAGE_SETTLE_MS / 1000} seconds`,
          now,
          replica.map((m) => m.legacyInput ?? m.input),
          replica.map((m) => m.legacyFactor ?? m.factor),
        ],
      );
      // Buckets whose inputs vanished (e.g. a deleted project) still become final.
      await manager.query(
        `UPDATE lw_usage_1h SET final = true, updated_at = $2 WHERE NOT final AND bucket + INTERVAL '1 hour' + $1::interval <= $2`,
        [`${USAGE_SETTLE_MS / 1000} seconds`, now],
      );
    });
  }

  async retention(): Promise<void> {
    await this.dataSource.query(`DELETE FROM lw_usage_1h WHERE bucket < now() - INTERVAL '${USAGE_RETENTION}'`);
    await this.dataSource.query(
      `DELETE FROM lw_usage_samples WHERE "time" < now() - INTERVAL '${USAGE_SAMPLE_RETENTION}'`,
    );
  }

  /** One project's usage: readers of the project (members, auditors, infra operators, cluster admins). */
  async forProject(req: RequestWithUser | undefined, project: string, q: UsageQuery): Promise<UsageReport> {
    await this.access.assertRead(req, project);

    return await this.report({ ...q, projects: [project] });
  }

  /** Usage of all projects: cluster roles only (Decabill's collector uses a PAT of an auditor). */
  async forCluster(req: RequestWithUser | undefined, q: ClusterUsageQuery): Promise<UsageReport> {
    const caller = await this.access.caller(req);

    if (!caller.clusterRole) throw new ForbiddenException('cluster-wide usage needs a cluster role');

    return await this.report({
      ...q,
      ...(q.project ? { projects: [q.project] } : {}),
    });
  }

  /** Totals per meter of a project (or all projects) over a range, for the periodic reports (3.25). */
  async totals(project: string | null, from: Date, to: Date): Promise<Partial<Record<UsageMeter, number>>> {
    const rows: { meter: UsageMeter; value: number }[] = await this.dataSource.query(
      `SELECT meter, sum(value) AS value FROM lw_usage_1h WHERE bucket >= $1 AND bucket < $2 ${project ? 'AND project = $3' : ''} GROUP BY meter`,
      project ? [from, to, project] : [from, to],
    );

    return Object.fromEntries(rows.map((r) => [r.meter, roundUsage(Number(r.value))]));
  }

  async report(
    q: UsageQuery & { projects?: string[]; billingSubscription?: string },
    now = new Date(),
  ): Promise<UsageReport> {
    const { from, to, granularity } = resolveUsageRange(q, now);
    const params: unknown[] = [from, to];
    const where = [`bucket >= $1`, `bucket < $2`];

    if (q.projects) {
      params.push(q.projects);
      where.push(`project = ANY($${params.length})`);
    }

    if (q.meter) {
      params.push(q.meter);
      where.push(`meter = $${params.length}`);
    }

    if (q.billingSubscription) {
      params.push(q.billingSubscription);
      where.push(`billing_subscription = $${params.length}`);
    }

    if (q.finalOnly) where.push('final');

    const rows: {
      project: string;
      meter: UsageMeter;
      b: Date;
      value: number;
      final: boolean;
      billing_subscription: string | null;
    }[] = await this.dataSource.query(
      `SELECT project, meter, date_trunc($${params.length + 1}::text, bucket AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS b,
              sum(value) AS value, bool_and(final) AS final, max(billing_subscription) AS billing_subscription
       FROM lw_usage_1h WHERE ${where.join(' AND ')}
       GROUP BY project, meter, b ORDER BY b, project, meter LIMIT ${USAGE_MAX_ROWS + 1}`,
      [...params, granularity],
    );
    const totals: { project: string; meter: UsageMeter; value: number }[] = await this.dataSource.query(
      `SELECT project, meter, sum(value) AS value FROM lw_usage_1h WHERE ${where.join(' AND ')}
       GROUP BY project, meter ORDER BY project, meter`,
      params,
    );
    const cluster = await this.cluster();
    const settledBy = now.getTime() - USAGE_SETTLE_MS;

    return {
      cluster,
      from: from.toISOString(),
      to: to.toISOString(),
      granularity,
      meters: usageMeterCatalog().filter((m) => !q.meter || m.key === q.meter),
      rows: rows.slice(0, USAGE_MAX_ROWS).map((r): UsageRow => {
        const bucket = new Date(r.b);

        return {
          project: r.project,
          bucket: bucket.toISOString(),
          meter: r.meter,
          value: roundUsage(Number(r.value)),
          // A day / month is final once all its hours are and it has ended (no hour can still appear).
          final: !!r.final && bucketEnd(bucket, granularity).getTime() <= settledBy,
          ...(granularity === 'hour'
            ? {
                idempotencyKey: usageIdempotencyKey(cluster, r.project, r.meter, bucket),
                billingSubscription: r.billing_subscription,
              }
            : {}),
        };
      }),
      totals: totals.map((t) => ({ project: t.project, meter: t.meter, value: roundUsage(Number(t.value)) })),
      truncated: rows.length > USAGE_MAX_ROWS,
    };
  }

  private async cluster(): Promise<string> {
    if (this.clusterId) return this.clusterId;

    const [row] = await this.dataSource.getRepository(ClusterEntity).find({ select: { clusterId: true }, take: 1 });

    // No fallback id: the cluster id is part of the billing idempotency keys, a placeholder would double-bill (M6).
    if (!row?.clusterId) throw new ServiceUnavailableException('cluster identity not initialised yet; retry later');

    this.clusterId = row.clusterId;

    return row.clusterId;
  }
}
