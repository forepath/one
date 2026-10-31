import type { MetricsReport } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { DataSource } from 'typeorm';

import { databaseTarget } from '../database-handover/database-target.runtime';

const RPS_FRESH_MS = 60_000;
const DENIED_WINDOW_MS = 5 * 60_000;
const AS_OF_CACHE_MS = 60_000;

/**
 * The traffic numbers of the cluster overview while the control plane is read-only (3.43 fallback): the agents keep
 * sending metrics, but `lw_metrics` / `lw_flows` can't store them, so the overview's "requests per second" and "denied
 * packets (5 min)" dropped to 0 (user, 2026-10-31: everything shown reflects the real state). Only what those two
 * numbers need is kept, bounded: the latest `ingress.requests_per_s` per node and host, and the denied packets of the
 * last 5 minutes per report.
 */
export class LiveTraffic {
  private readonly rps = new Map<string, { at: number; value: number }>();
  private denied: { at: number; packets: number }[] = [];

  record(node: string, report: Pick<MetricsReport, 'samples' | 'flows'>, at: number): void {
    for (const s of report.samples)
      if (s.metric === 'ingress.requests_per_s') this.rps.set(`${node}\u0000${s.entity}`, { at, value: s.value });

    const packets = report.flows.filter((f) => f.decision === 'denied').reduce((n, f) => n + f.packets, 0);

    this.denied = this.denied.filter((d) => at - d.at < DENIED_WINDOW_MS);

    if (packets > 0) this.denied.push({ at, packets });

    for (const [key, sample] of this.rps) if (at - sample.at >= RPS_FRESH_MS) this.rps.delete(key);
  }

  /** Sum over the latest sample per node and host of the last minute (as the stored query). */
  requestsPerSecond(now: number): number {
    return [...this.rps.values()].filter((s) => now - s.at < RPS_FRESH_MS).reduce((n, s) => n + s.value, 0);
  }

  deniedPackets5m(now: number): number {
    return this.denied.filter((d) => now - d.at < DENIED_WINDOW_MS).reduce((n, d) => n + d.packets, 0);
  }

  clear(): void {
    this.rps.clear();
    this.denied = [];
  }
}

/** One per process (the stream server's ingest feeds it, the overview reads it). */
export const liveTraffic = new LiveTraffic();

let asOfCache: { at: number; value: Date | null } | null = null;

/**
 * Until when the stored metrics reach, while the control plane is read-only (3.43 fallback), else `null`: nothing is
 * stored during the fallback, so the last stored sample is the time series' "as of" (SLOs, uptime). Cached a minute.
 */
export async function frozenMetricsAsOf(
  dataSource: Pick<DataSource, 'query'>,
  now = Date.now(),
  fallback = databaseTarget.fallback,
): Promise<Date | null> {
  if (!fallback) {
    asOfCache = null;

    return null;
  }

  if (asOfCache && now - asOfCache.at < AS_OF_CACHE_MS) return asOfCache.value;

  const rows = (await dataSource.query(`SELECT max("time") AS t FROM lw_metrics`).catch(() => [])) as {
    t: Date | string | null;
  }[];
  const value = rows[0]?.t ? new Date(rows[0].t) : null;

  asOfCache = { at: now, value: value && !Number.isNaN(value.getTime()) ? value : null };

  return asOfCache.value;
}

/** Tests. */
export function resetFrozenMetricsAsOf(): void {
  asOfCache = null;
}
