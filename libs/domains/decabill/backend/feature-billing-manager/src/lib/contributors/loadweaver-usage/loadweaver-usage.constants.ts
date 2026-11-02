import type { DeclaredMeterDefinition } from '../../dto/declared-meter.dto';
import type { AddonConfigFieldDefinition } from '../../utils/addon-config.utils';

/** Addon module key: a catalog addon per Loadweaver cluster whose capacity is resold. */
export const LOADWEAVER_USAGE_MODULE_KEY = 'loadweaver-usage';

/** Admin defaults of the catalog addon (never taken from a subscription's config snapshot). */
export const LOADWEAVER_USAGE_URL_KEY = 'LOADWEAVER_API_URL';
export const LOADWEAVER_USAGE_TOKEN_KEY = 'LOADWEAVER_API_TOKEN';

/** Loadweaver buckets are hourly; Decabill pulls once an hour per meter. */
export const LOADWEAVER_USAGE_COLLECT_INTERVAL_MS = 3_600_000;
/**
 * An hour is collected once Loadweaver marked it final (15 minutes after the hour, roll-up every 5 minutes): the
 * primary range of a collect window is shifted back by this much.
 */
export const LOADWEAVER_USAGE_SETTLE_MS = 20 * 60_000;
/** Final hours this far before the primary range are offered again (deduplicated by idempotency key). */
export const LOADWEAVER_USAGE_LOOKBACK_MS = 3 * 3_600_000;
export const LOADWEAVER_USAGE_TIMEOUT_MS = 15_000;

export const LOADWEAVER_USAGE_CONFIG_FIELDS: AddonConfigFieldDefinition[] = [
  {
    key: LOADWEAVER_USAGE_URL_KEY,
    label: 'Loadweaver API URL',
    description: 'Control plane API URL including /api, e.g. https://loadweaver.example.com/api (HTTPS).',
    showInOrderForm: false,
  },
  {
    key: LOADWEAVER_USAGE_TOKEN_KEY,
    label: 'Loadweaver access token',
    description: 'Personal access token of a Loadweaver auditor with the usage:read scope.',
    showInOrderForm: false,
    // Used by the collector from the catalog defaults only; never copied into subscription snapshots.
    adminOnly: true,
  },
];

/** Decabill meter key → Loadweaver meter (`GET /usage`). */
export const LOADWEAVER_USAGE_METER_MAP: Record<string, string> = {
  'loadweaver.cpu_core_hours': 'cpu_core_hours',
  'loadweaver.memory_gib_hours': 'memory_gib_hours',
  'loadweaver.storage_gib_hours': 'storage_gib_hours',
  'loadweaver.storage_replica_gib_hours': 'storage_replica_gib_hours',
  'loadweaver.traffic_in_gb': 'traffic_in_gb',
  'loadweaver.traffic_out_gb': 'traffic_out_gb',
  'loadweaver.public_ip_hours': 'public_ip_hours',
};

const meter = (key: string, name: string, unitLabel: string, description: string): DeclaredMeterDefinition => ({
  key,
  name,
  unitLabel,
  description,
  aggregator: 'sum',
  // Hosters set their own prices on the catalog meter or the addon attachment.
  defaultUnitPriceNet: 0,
  collectionIntervalMs: LOADWEAVER_USAGE_COLLECT_INTERVAL_MS,
});

export const LOADWEAVER_USAGE_METERS: DeclaredMeterDefinition[] = [
  meter('loadweaver.cpu_core_hours', 'Loadweaver CPU', 'core-hours', 'CPU used by the mapped projects'),
  meter('loadweaver.memory_gib_hours', 'Loadweaver memory', 'GiB-hours', 'Memory used by the mapped projects'),
  meter('loadweaver.storage_gib_hours', 'Loadweaver storage', 'GiB-hours', 'Provisioned volume size, each volume once'),
  meter(
    'loadweaver.storage_replica_gib_hours',
    'Loadweaver storage incl. replicas',
    'GiB-hours',
    'Provisioned volume size times its copies',
  ),
  meter('loadweaver.traffic_in_gb', 'Loadweaver traffic in', 'GB', 'Bytes received by the mapped projects'),
  meter('loadweaver.traffic_out_gb', 'Loadweaver traffic out', 'GB', 'Bytes sent by the mapped projects'),
  meter('loadweaver.public_ip_hours', 'Loadweaver public IPs', 'IP-hours', 'Public addresses of the mapped projects'),
];
