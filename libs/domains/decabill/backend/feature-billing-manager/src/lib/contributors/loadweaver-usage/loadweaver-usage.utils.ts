import type { MeterCollectSample } from '../../dto/meter-collect.types';
import {
  LOADWEAVER_USAGE_LOOKBACK_MS,
  LOADWEAVER_USAGE_METER_MAP,
  LOADWEAVER_USAGE_SETTLE_MS,
  LOADWEAVER_USAGE_TOKEN_KEY,
  LOADWEAVER_USAGE_URL_KEY,
} from './loadweaver-usage.constants';

const HOUR_MS = 3_600_000;

/** The part of Loadweaver's `GET /usage` answer the collector reads (hourly granularity). */
export interface LoadweaverUsageReport {
  cluster: string;
  rows: Array<{
    project: string;
    bucket: string;
    meter: string;
    value: number;
    final: boolean;
    idempotencyKey?: string;
    billingSubscription?: string | null;
  }>;
  truncated: boolean;
}

export interface LoadweaverUsageConnection {
  url: string;
  token: string;
}

/**
 * The cluster connection from the catalog addon's admin defaults. Customers can put any declared key into their
 * order's addon config, so the snapshot is never used: a customer must not point the collector at their own server.
 */
export function resolveLoadweaverUsageConnection(
  defaults: Record<string, string> | null | undefined,
  allowHttp = process.env.BILLING_LOADWEAVER_USAGE_ALLOW_HTTP === 'true',
): LoadweaverUsageConnection {
  const rawUrl = defaults?.[LOADWEAVER_USAGE_URL_KEY]?.trim() ?? '';
  const token = defaults?.[LOADWEAVER_USAGE_TOKEN_KEY]?.trim() ?? '';

  if (!rawUrl || !token) {
    throw new Error(
      `Loadweaver usage addon needs ${LOADWEAVER_USAGE_URL_KEY} and ${LOADWEAVER_USAGE_TOKEN_KEY} defaults`,
    );
  }

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${LOADWEAVER_USAGE_URL_KEY} is not a valid URL`);
  }

  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new Error(`${LOADWEAVER_USAGE_URL_KEY} must use HTTPS`);
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${LOADWEAVER_USAGE_URL_KEY} must not contain credentials, a query or a fragment`);
  }

  return { url: url.toString().replace(/\/+$/, ''), token };
}

/**
 * What to ask Loadweaver for a collect window `[periodStart, periodEnd]`. Hours are assigned by their end: the
 * primary range is `(periodStart − settle, periodEnd − settle]`, so consecutive windows (each starting at the last
 * one's end) split the hours without gaps or overlap, and every hour is final by the time it is due. The query also
 * covers a lookback before the primary range; hours there that were already recorded are skipped by their
 * idempotency key, hours that weren't (e.g. not final yet last time) are recorded now.
 */
export function loadweaverUsageWindow(
  periodStart: Date,
  periodEnd: Date,
): { from: Date; to: Date; primaryFrom: Date; primaryTo: Date } {
  const primaryFrom = new Date(periodStart.getTime() - LOADWEAVER_USAGE_SETTLE_MS);
  const primaryTo = new Date(periodEnd.getTime() - LOADWEAVER_USAGE_SETTLE_MS);
  const from = new Date(
    Math.floor((primaryFrom.getTime() - LOADWEAVER_USAGE_LOOKBACK_MS - HOUR_MS) / HOUR_MS) * HOUR_MS,
  );

  return { from, to: primaryTo, primaryFrom, primaryTo };
}

/**
 * The samples of one Decabill meter from a Loadweaver answer: one per final hour, project and meter with its
 * idempotency key (`loadweaver:<cluster>:<project>:<meter>:<hour>`). When the primary range has no usage, one zero
 * sample keyed by the window end marks the window as collected (otherwise it would be due again every minute).
 */
export function loadweaverUsageSamples(params: {
  report: LoadweaverUsageReport;
  meterKey: string;
  subscriptionId: string;
  periodStart: Date;
  periodEnd: Date;
}): MeterCollectSample[] {
  const meter = LOADWEAVER_USAGE_METER_MAP[params.meterKey];

  if (!meter) {
    return [];
  }

  const window = loadweaverUsageWindow(params.periodStart, params.periodEnd);
  const samples: MeterCollectSample[] = [];
  let primary = 0;

  for (const row of params.report.rows) {
    if (row.meter !== meter || !row.final || !row.idempotencyKey) continue;

    // Defense in depth: Loadweaver filters by subscription; never bill another subscription's project.
    if (row.billingSubscription !== params.subscriptionId) continue;

    if (!Number.isFinite(row.value) || row.value <= 0) continue;

    const end = new Date(row.bucket).getTime() + HOUR_MS;

    if (Number.isNaN(end) || end > window.primaryTo.getTime() || end <= window.from.getTime()) continue;

    if (end > window.primaryFrom.getTime()) primary++;

    samples.push({
      meterKey: params.meterKey,
      value: row.value,
      idempotencyKey: row.idempotencyKey,
      usagePayload: {
        source: 'loadweaver',
        cluster: params.report.cluster,
        project: row.project,
        meter,
        bucket: new Date(row.bucket).toISOString(),
      },
    });
  }

  if (primary === 0) {
    samples.push({
      meterKey: params.meterKey,
      value: 0,
      idempotencyKey: `loadweaver:${params.report.cluster}:window:${params.subscriptionId}:${meter}:${params.periodEnd.toISOString()}`,
      usagePayload: { source: 'loadweaver', cluster: params.report.cluster, meter, empty: true },
    });
  }

  return samples;
}
