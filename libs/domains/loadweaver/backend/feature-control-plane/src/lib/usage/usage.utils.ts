import { BadRequestException } from '@nestjs/common';

import { toCsv } from '../utils/csv.utils';
import {
  USAGE_MAX_RANGE_DAYS,
  USAGE_METER_DEFINITIONS,
  USAGE_SETTLE_MS,
  type UsageGranularity,
  type UsageMeter,
} from './usage.constants';

/** One bucket of one meter of one project. */
export interface UsageRow {
  project: string;
  bucket: string;
  meter: UsageMeter;
  value: number;
  /** Final buckets never change again (billable). A day / month is final when all its hours are. */
  final: boolean;
  /** Hourly buckets: `loadweaver:<cluster>:<project>:<meter>:<bucket>`, unique per billing record. */
  idempotencyKey?: string;
  /** Decabill subscription the project was mapped to when the bucket was computed. */
  billingSubscription?: string | null;
}

export interface UsageReport {
  cluster: string;
  from: string;
  to: string;
  granularity: UsageGranularity;
  meters: { key: UsageMeter; unit: string; description: string }[];
  rows: UsageRow[];
  /** Per project and meter over the whole range. */
  totals: { project: string; meter: UsageMeter; value: number }[];
  /** More rows matched than one answer carries; narrow the range or the projects. */
  truncated: boolean;
}

export interface UsageRangeQuery {
  from?: string;
  to?: string;
  granularity?: UsageGranularity;
}

/** The start of the hour / day / month (UTC) a time falls into. */
export function floorTo(date: Date, granularity: UsageGranularity): Date {
  const d = new Date(date.getTime());

  d.setUTCMinutes(0, 0, 0);

  if (granularity === 'hour') return d;

  d.setUTCHours(0);

  if (granularity === 'day') return d;

  d.setUTCDate(1);

  return d;
}

/**
 * The range of a usage query: `from` floored to the granularity (default: start of the current month, UTC), `to`
 * as given (default: now); buckets starting in `[from, to)` count. Ranges are bounded per granularity.
 */
export function resolveUsageRange(
  q: UsageRangeQuery,
  now = new Date(),
): { from: Date; to: Date; granularity: UsageGranularity } {
  const granularity = q.granularity ?? 'day';
  const to = q.to ? new Date(q.to) : now;
  const rawFrom = q.from ? new Date(q.from) : floorTo(now, 'month');

  if (Number.isNaN(to.getTime()) || Number.isNaN(rawFrom.getTime()))
    throw new BadRequestException('invalid time range');

  const from = floorTo(rawFrom, granularity);

  if (from >= to) throw new BadRequestException('invalid time range');

  if (to.getTime() - from.getTime() > USAGE_MAX_RANGE_DAYS[granularity] * 86_400_000)
    throw new BadRequestException(
      `range too long for granularity ${granularity} (at most ${USAGE_MAX_RANGE_DAYS[granularity]} days)`,
    );

  return { from, to, granularity };
}

/** Whether an hour bucket is past the settle time (its value no longer changes). */
export function isFinalBucket(bucket: Date, now: Date): boolean {
  return bucket.getTime() + 3_600_000 + USAGE_SETTLE_MS <= now.getTime();
}

/** The idempotency key of one hourly billing record, stable across exports and collectors. */
export function usageIdempotencyKey(
  cluster: string,
  project: string,
  meter: UsageMeter,
  bucket: Date | string,
): string {
  return `loadweaver:${cluster}:${project}:${meter}:${new Date(bucket).toISOString()}`;
}

/** `egress/<project>/<policy>/<i>`: egress addresses of project policies are the project's public addresses. */
export const PROJECT_EGRESS_OWNER = '^egress/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)/[^/]+/[0-9]+$';

/** The project of a public address owner, or null for cluster addresses (ingress, DNS, VPN, cluster policies). */
export function publicAddressProject(owner: string | null): string | null {
  const match = owner ? new RegExp(PROJECT_EGRESS_OWNER).exec(owner) : null;

  return match ? match[1] : null;
}

/** The meter catalog of an answer. */
export function usageMeterCatalog(): UsageReport['meters'] {
  return USAGE_METER_DEFINITIONS.map((m) => ({ key: m.key, unit: m.unit, description: m.description }));
}

/** Rounds to 6 decimals (Decabill stores `numeric(18,6)`), so exports and invoices agree. */
export function roundUsage(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Totals per project and meter, sorted. */
export function usageTotals(rows: readonly UsageRow[]): UsageReport['totals'] {
  const totals = new Map<string, { project: string; meter: UsageMeter; value: number }>();

  for (const row of rows) {
    const key = `${row.project}\u0000${row.meter}`;
    const total = totals.get(key) ?? { project: row.project, meter: row.meter, value: 0 };

    total.value += row.value;
    totals.set(key, total);
  }

  return [...totals.values()]
    .map((t) => ({ ...t, value: roundUsage(t.value) }))
    .sort((a, b) => a.project.localeCompare(b.project) || a.meter.localeCompare(b.meter));
}

/** CSV export: one line per bucket, project and meter (`idempotency_key` filled for hourly buckets). */
export function usageCsv(report: UsageReport): string {
  const units = new Map(report.meters.map((m) => [m.key, m.unit]));

  return toCsv(
    ['project', 'bucket', 'granularity', 'meter', 'unit', 'value', 'final', 'idempotency_key'],
    report.rows.map((r) => [
      r.project,
      r.bucket,
      report.granularity,
      r.meter,
      units.get(r.meter) ?? '',
      r.value,
      r.final ? 'true' : 'false',
      r.idempotencyKey ?? '',
    ]),
  );
}
