/** Usage metering per project (3.24): the control plane's `GET /usage` and `GET /projects/:p/usage`. */
export type UsageMeterKey =
  | 'cpu_core_hours'
  | 'memory_gib_hours'
  | 'storage_gib_hours'
  | 'storage_replica_gib_hours'
  | 'traffic_in_gb'
  | 'traffic_out_gb'
  | 'public_ip_hours';

export type UsageGranularity = 'hour' | 'day' | 'month';

export interface UsageQuery {
  /** One project (`/projects/:p/usage`); empty: all projects (`/usage`, cluster roles). */
  project?: string | null;
  from?: string;
  to?: string;
  granularity: UsageGranularity;
}

export interface UsageRow {
  project: string;
  bucket: string;
  meter: UsageMeterKey;
  value: number;
  final: boolean;
  idempotencyKey?: string;
  billingSubscription?: string | null;
}

export interface UsageReport {
  cluster: string;
  from: string;
  to: string;
  granularity: UsageGranularity;
  meters: { key: UsageMeterKey; unit: string; description: string }[];
  rows: UsageRow[];
  totals: { project: string; meter: UsageMeterKey; value: number }[];
  truncated: boolean;
}
