import type {
  StatisticsEgressBreakdownItem,
  StatisticsFilterTypesBreakdownItem,
  StatisticsSecuritySeriesPoint,
} from '@forepath/agenstra/frontend/data-access-agent-console';

export interface AlignedSecuritySeries {
  categories: string[];
  filterDrops: number[];
  filterFlags: number[];
  egressAllowed: number[];
  egressBlocked: number[];
  egressObserved: number[];
}

function utcBucketKey(period: string, groupBy: 'day' | 'hour'): string {
  const date = new Date(period);

  if (Number.isNaN(date.getTime())) {
    return period;
  }

  return groupBy === 'day'
    ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString()
    : new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()),
      ).toISOString();
}

/**
 * Align security series points with every bucket of the selected range (gaps become zero).
 * When no bucket keys are available, the API points are used as categories.
 */
export function alignSecuritySeries(
  points: readonly StatisticsSecuritySeriesPoint[],
  bucketKeys: readonly string[],
  groupBy: 'day' | 'hour',
): AlignedSecuritySeries {
  const byBucket = new Map<string, StatisticsSecuritySeriesPoint>();

  for (const point of points) {
    const key = utcBucketKey(point.period, groupBy);
    const existing = byBucket.get(key);

    byBucket.set(
      key,
      existing
        ? {
            period: key,
            filterDrops: existing.filterDrops + point.filterDrops,
            filterFlags: existing.filterFlags + point.filterFlags,
            egressAllowed: existing.egressAllowed + point.egressAllowed,
            egressBlocked: existing.egressBlocked + point.egressBlocked,
            egressObserved: existing.egressObserved + point.egressObserved,
          }
        : { ...point, period: key },
    );
  }

  const categories = bucketKeys.length > 0 ? [...bucketKeys] : [...byBucket.keys()].sort();
  const pick = (field: keyof Omit<StatisticsSecuritySeriesPoint, 'period'>) =>
    categories.map((key) => byBucket.get(key)?.[field] ?? 0);

  return {
    categories,
    filterDrops: pick('filterDrops'),
    filterFlags: pick('filterFlags'),
    egressAllowed: pick('egressAllowed'),
    egressBlocked: pick('egressBlocked'),
    egressObserved: pick('egressObserved'),
  };
}

/** Whether any egress data exists in a summary breakdown (hides empty egress charts). */
export function hasEgressData(breakdown: readonly StatisticsEgressBreakdownItem[] | undefined): boolean {
  return (breakdown ?? []).some((item) => item.count > 0);
}

/** Human-readable label for a guard rule identifier. */
export function formatEgressRule(rule: string | null | undefined): string {
  switch (rule) {
    case 'deny_host':
      return $localize`:@@featureAudit-egressRuleDenyHost:Denylisted destination`;
    case 'not_allowlisted':
      return $localize`:@@featureAudit-egressRuleNotAllowlisted:Not on the allowlist`;
    case 'private_network':
      return $localize`:@@featureAudit-egressRulePrivateNetwork:Private network`;
    case 'ip_literal':
      return $localize`:@@featureAudit-egressRuleIpLiteral:IP literal`;
    case 'deny_url':
      return $localize`:@@featureAudit-egressRuleDenyUrl:Blocked URL pattern`;
    case 'offline':
      return $localize`:@@featureAudit-egressRuleOffline:Offline mode`;
    case 'quic':
      return $localize`:@@featureAudit-egressRuleQuic:QUIC (UDP/443)`;
    case 'dns_over_tls':
      return $localize`:@@featureAudit-egressRuleDnsOverTls:DNS over TLS`;
    case 'undeclared_protocol':
      return $localize`:@@featureAudit-egressRuleUndeclared:Undeclared protocol / port`;
    case 'guard':
      return $localize`:@@featureAudit-egressRuleGuard:Guard`;
    case null:
    case undefined:
    case '':
      return '-';
    default:
      return rule;
  }
}

/** Human-readable label for an egress decision. */
export function formatEgressDecision(decision: string): string {
  switch (decision) {
    case 'allowed':
      return $localize`:@@featureAudit-egressDecisionAllowed:Allowed`;
    case 'blocked':
      return $localize`:@@featureAudit-egressDecisionBlocked:Blocked`;
    case 'observed':
      return $localize`:@@featureAudit-egressDecisionObserved:Would be blocked`;
    case 'error':
      return $localize`:@@featureAudit-egressDecisionError:Guard error`;
    default:
      return decision;
  }
}

/** Human-readable label for an egress event kind. */
export function formatEgressKind(kind: string): string {
  switch (kind) {
    case 'web':
      return $localize`:@@featureAudit-egressKindWeb:Web`;
    case 'dns':
      return $localize`:@@featureAudit-egressKindDns:DNS`;
    case 'network':
      return $localize`:@@featureAudit-egressKindNetwork:Network`;
    case 'guard':
      return $localize`:@@featureAudit-egressKindGuard:Guard`;
    default:
      return kind;
  }
}

/** Badge color for an egress decision. */
export function egressDecisionColor(decision: string): 'success' | 'danger' | 'warning' | 'secondary' {
  switch (decision) {
    case 'allowed':
      return 'success';
    case 'blocked':
    case 'error':
      return 'danger';
    case 'observed':
      return 'warning';
    default:
      return 'secondary';
  }
}

/** Compact byte formatting for table cells. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/** Donut legend entry of a filter drop / flag breakdown: `Drop: <rule name> (Incoming)`; raw key only for legacy rows. */
export function filterBreakdownLabel(
  prefix: string,
  item: Pick<StatisticsFilterTypesBreakdownItem, 'filterType' | 'filterDisplayName'>,
  directionLabel: string,
): string {
  return `${prefix}: ${item.filterDisplayName?.trim() || item.filterType} (${directionLabel})`;
}

/**
 * Y axis bounds for count charts (messages, events): whole-number ticks only (AG-08: no 0.5 steps). Up to 5 the axis
 * shows one tick per unit (an empty range shows 0–1); above, Apex picks a nice scale with integer labels.
 */
export function countAxisScale(
  series: readonly (readonly number[])[],
  stacked = false,
): {
  min: number;
  max?: number;
  tickAmount?: number;
  forceNiceScale: boolean;
  decimalsInFloat: number;
} {
  const length = Math.max(0, ...series.map((values) => values.length));
  let max = 0;

  for (let i = 0; i < length; i++) {
    const values = series.map((s) => s[i] ?? 0);

    max = Math.max(max, stacked ? values.reduce((sum, v) => sum + v, 0) : Math.max(0, ...values));
  }

  if (max <= 5) {
    const top = Math.max(1, Math.ceil(max));

    return { min: 0, max: top, tickAmount: top, forceNiceScale: false, decimalsInFloat: 0 };
  }

  return { min: 0, forceNiceScale: true, decimalsInFloat: 0 };
}
