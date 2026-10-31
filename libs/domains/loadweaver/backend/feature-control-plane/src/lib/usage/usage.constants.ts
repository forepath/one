/**
 * Usage metering per project (3.24): what is metered, in which unit, and from which source. Hourly buckets in
 * `lw_usage_1h` are the billing record; Decabill's usage meters consume them (`docs/decabill/features/usage-meters.md`).
 */
export const USAGE_METERS = [
  'cpu_core_hours',
  'memory_gib_hours',
  'storage_gib_hours',
  'storage_replica_gib_hours',
  'traffic_in_gb',
  'traffic_out_gb',
  'public_ip_hours',
] as const;

export type UsageMeter = (typeof USAGE_METERS)[number];

export const USAGE_GRANULARITIES = ['hour', 'day', 'month'] as const;

export type UsageGranularity = (typeof USAGE_GRANULARITIES)[number];

/**
 * Seconds one legacy replica sample stands for (the node agent's nominal interval, `METRICS_INTERVAL_MS`). Only used
 * for agents one release behind (N-1) that don't report the integrated usage metrics yet: their skipped ticks are
 * under-metered, as before.
 */
export const REPLICA_SAMPLE_SECONDS = 10;
/** Minutes one allocation sample (volumes, public addresses) stands for. */
export const ALLOCATION_SAMPLE_MINUTES = 5;
const GIB = 1024 ** 3;
const GB = 1e9;

export interface UsageMeterDefinition {
  key: UsageMeter;
  unit: string;
  description: string;
  /** `replica`: from the 1-minute roll-up of a replica metric; `allocation`: from the control plane's samples. */
  source: 'replica' | 'allocation';
  /**
   * Replica meters: the integrated metric in `lw_metrics_1m` (each sample covers the measured time since the replica's
   * previous reading: CPU-seconds, byte-seconds, byte deltas); allocation meters: the sampled quantity in
   * `lw_usage_samples`.
   */
  input: string;
  /**
   * Replica meters: factor turning `sum(avg × samples)` (the sum of all raw samples) into the unit. Allocation
   * meters: factor turning `sum(value)` (one sample per `ALLOCATION_SAMPLE_MINUTES`) into the unit.
   */
  factor: number;
  /**
   * Replica meters: the instantaneous metric N-1 agents report instead (gauge or per-second rate), and its factor
   * assuming `REPLICA_SAMPLE_SECONDS` per sample. Used for a replica's minute only when it has no integrated sample.
   */
  legacyInput?: string;
  legacyFactor?: number;
}

export const USAGE_METER_DEFINITIONS: readonly UsageMeterDefinition[] = [
  {
    key: 'cpu_core_hours',
    unit: 'core-hours',
    description: 'CPU used by the project’s replicas (cores × hours)',
    source: 'replica',
    input: 'replica.cpu_seconds',
    factor: 1 / 3600,
    legacyInput: 'replica.cpu_cores',
    legacyFactor: REPLICA_SAMPLE_SECONDS / 3600,
  },
  {
    key: 'memory_gib_hours',
    unit: 'GiB-hours',
    description: 'Memory used by the project’s replicas (GiB × hours)',
    source: 'replica',
    input: 'replica.memory_byte_seconds',
    factor: 1 / 3600 / GIB,
    legacyInput: 'replica.memory_bytes',
    legacyFactor: REPLICA_SAMPLE_SECONDS / 3600 / GIB,
  },
  {
    key: 'storage_gib_hours',
    unit: 'GiB-hours',
    description: 'Provisioned volume size, each volume once (as the storage quota counts it)',
    source: 'allocation',
    input: 'storage_gib',
    factor: ALLOCATION_SAMPLE_MINUTES / 60,
  },
  {
    key: 'storage_replica_gib_hours',
    unit: 'GiB-hours',
    description: 'Provisioned volume size times its copies (primary, synchronous and remote replicas)',
    source: 'allocation',
    input: 'storage_replica_gib',
    factor: ALLOCATION_SAMPLE_MINUTES / 60,
  },
  {
    key: 'traffic_in_gb',
    unit: 'GB',
    description: 'Bytes received by the project’s replicas (incl. traffic inside the cluster)',
    source: 'replica',
    input: 'replica.net_rx_bytes',
    factor: 1 / GB,
    legacyInput: 'replica.net_rx_bytes_per_s',
    legacyFactor: REPLICA_SAMPLE_SECONDS / GB,
  },
  {
    key: 'traffic_out_gb',
    unit: 'GB',
    description: 'Bytes sent by the project’s replicas (incl. traffic inside the cluster)',
    source: 'replica',
    input: 'replica.net_tx_bytes',
    factor: 1 / GB,
    legacyInput: 'replica.net_tx_bytes_per_s',
    legacyFactor: REPLICA_SAMPLE_SECONDS / GB,
  },
  {
    key: 'public_ip_hours',
    unit: 'IP-hours',
    description: 'Public addresses assigned to the project (egress addresses of its policies)',
    source: 'allocation',
    input: 'public_ips',
    factor: ALLOCATION_SAMPLE_MINUTES / 60,
  },
];

/** An hour bucket becomes final (immutable, billable) this long after it ended, so late samples are in. */
export const USAGE_SETTLE_MS = 15 * 60_000;
/** How far back the roll-up recomputes buckets that aren't final yet. */
export const USAGE_RECOMPUTE_HOURS = 3;
/** Billing record retention: 25 months (a full year compared with the year before, plus late invoicing). */
export const USAGE_RETENTION = '760 days';
/** Allocation samples are only an input for the hourly buckets. */
export const USAGE_SAMPLE_RETENTION = '7 days';
/** Longest range per granularity (keeps answers bounded). */
export const USAGE_MAX_RANGE_DAYS: Record<UsageGranularity, number> = { hour: 93, day: 400, month: 800 };
/** Rows per answer at most; `truncated` says when there were more. */
export const USAGE_MAX_ROWS = 50_000;
