import type {
  MetricSeries,
  UsageGranularity,
  UsageMeterKey,
  UsageReport,
  UsageRow,
} from '@forepath/loadweaver/frontend/data-access-console';

/** The meters in display order (the API's catalog order). */
export const USAGE_METER_ORDER: readonly UsageMeterKey[] = [
  'cpu_core_hours',
  'memory_gib_hours',
  'storage_gib_hours',
  'storage_replica_gib_hours',
  'traffic_in_gb',
  'traffic_out_gb',
  'public_ip_hours',
];

/** One table line: a bucket of a project with a value per meter. */
export interface UsageTableRow {
  bucket: string;
  project: string;
  values: Partial<Record<UsageMeterKey, number>>;
  /** All meters of the line are final. */
  final: boolean;
}

/** Rows (one per bucket, project and meter) as table lines, newest bucket first, then by project. */
export function pivotUsage(rows: readonly UsageRow[]): UsageTableRow[] {
  const lines = new Map<string, UsageTableRow>();

  for (const row of rows) {
    const key = `${row.bucket}\u0000${row.project}`;
    const line = lines.get(key) ?? { bucket: row.bucket, project: row.project, values: {}, final: true };

    line.values[row.meter] = (line.values[row.meter] ?? 0) + row.value;
    line.final = line.final && row.final;
    lines.set(key, line);
  }

  return [...lines.values()].sort((a, b) => b.bucket.localeCompare(a.bucket) || a.project.localeCompare(b.project));
}

/** Totals per meter over all projects of the answer. */
export function meterTotals(report: UsageReport | null): Partial<Record<UsageMeterKey, number>> {
  const totals: Partial<Record<UsageMeterKey, number>> = {};

  for (const t of report?.totals ?? []) totals[t.meter] = (totals[t.meter] ?? 0) + t.value;

  return totals;
}

/** The unit of a meter from the answer's catalog. */
export function meterUnit(report: UsageReport | null, meter: UsageMeterKey): string {
  return report?.meters.find((m) => m.key === meter)?.unit ?? '';
}

/** Date pipe format of a bucket (buckets are UTC). */
export function bucketFormat(granularity: UsageGranularity): string {
  switch (granularity) {
    case 'hour':
      return 'MMM d, y HH:mm';
    case 'day':
      return 'MMM d, y';
    default:
      return 'MMMM y';
  }
}

/** A value for display: up to 3 decimals, integers stay plain. */
export function formatUsageValue(value: number | undefined): string {
  if (value === undefined) return '–';

  return String(Math.round(value * 1000) / 1000);
}

/** Chart categories of the usage overview (3.38 decision 13) with their meters. */
export type UsageCategory = 'compute' | 'storage' | 'network';

export const USAGE_CATEGORIES: readonly { category: UsageCategory; meters: readonly UsageMeterKey[] }[] = [
  { category: 'compute', meters: ['cpu_core_hours', 'memory_gib_hours'] },
  { category: 'storage', meters: ['storage_gib_hours', 'storage_replica_gib_hours'] },
  { category: 'network', meters: ['traffic_in_gb', 'traffic_out_gb', 'public_ip_hours'] },
];

/** One meter over time as chart series: one series per project, buckets in time order. */
export function usageSeries(rows: readonly UsageRow[], meter: UsageMeterKey): MetricSeries[] {
  const byProject = new Map<string, Map<string, number>>();

  for (const row of rows) {
    if (row.meter !== meter) continue;

    const buckets = byProject.get(row.project) ?? new Map<string, number>();

    buckets.set(row.bucket, (buckets.get(row.bucket) ?? 0) + row.value);
    byProject.set(row.project, buckets);
  }

  return [...byProject.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([project, buckets]) => ({
      key: project,
      points: [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucket, value]): [string, number] => [bucket, value]),
    }));
}
