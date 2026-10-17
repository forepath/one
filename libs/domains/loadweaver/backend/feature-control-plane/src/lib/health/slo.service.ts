import type { RequestWithUser } from '@forepath/identity/backend';
import type { SloSpec } from '@forepath/loadweaver/shared/util-compose';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';

import { canReadProject, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { ResourceEntity } from '../entities/resource.entity';
import { WorkloadPlannerService } from '../services/workload-planner.service';
import {
  countsFromRates,
  hostPattern,
  latencyCounts,
  objectiveStatus,
  worstObjective,
  type ObjectiveStatus,
} from './slo.utils';

const CACHE_MS = 60_000;
const WINDOW_DAYS = { '7d': 7, '28d': 28, '30d': 30 } as const;
/** The agents' metrics interval. */
const SAMPLE_SECONDS = 10;

export interface SloDto {
  project: string;
  deployment: string;
  service: string;
  hosts: string[];
  window: SloSpec['window'];
  availability?: ObjectiveStatus;
  latency?: ObjectiveStatus & { percentile: 'p95' | 'p99'; thresholdMs: number };
  /** Availability since the start of the calendar month (UTC), in percent. */
  monthlyUptime: number | null;
  state: ObjectiveStatus['state'];
}

/**
 * SLOs of exposed services (3.25), measured at the ingress from the per-hostname request, error and latency metrics:
 * availability and latency objectives over a rolling window, error budget use, fast burn and monthly uptime.
 * Computed for the whole cluster at most once a minute and filtered per caller.
 */
@Injectable()
export class SloService {
  private cache: { at: number; slos: SloDto[] } | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly planner: WorkloadPlannerService,
  ) {}

  async list(req: RequestWithUser | undefined, project?: string): Promise<SloDto[]> {
    return await this.listFor(await this.access.caller(req), project);
  }

  async listFor(caller: AccessCaller, project?: string): Promise<SloDto[]> {
    if (project && !canReadProject(caller, project)) throw new NotFoundException('project not found');

    return (await this.all()).filter((s) => canReadProject(caller, s.project) && (!project || s.project === project));
  }

  /** Every SLO in the cluster (alerts, overview), cached for a minute. */
  async all(now = Date.now()): Promise<SloDto[]> {
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.slos;

    // One computation at a time: concurrent callers (status pages, overview, alerts) share it.
    this.inflight ??= this.compute(now).finally(() => (this.inflight = null));

    return await this.inflight;
  }

  private inflight: Promise<SloDto[]> | null = null;

  private async compute(now: number): Promise<SloDto[]> {
    const resources = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: { kind: In(['Project', 'Deployment']) } });
    const slos: SloDto[] = [];

    for (const d of this.planner.parse(resources).parsed)
      for (const s of d.compose.services.filter((x) => x.slo && x.http.length))
        slos.push(
          await this.evaluate(
            d.project,
            d.name,
            s.name,
            [...new Set(s.http.map((h) => h.host))],
            s.slo as SloSpec,
            now,
          ),
        );

    this.cache = { at: now, slos };

    return slos;
  }

  /** Availability of every service with an availability SLO over a fixed range (monthly reports, 3.25). */
  async availabilityBetween(
    from: Date,
    to: Date,
  ): Promise<{ project: string; deployment: string; service: string; availability: number | null; target: number }[]> {
    const resources = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: { kind: In(['Project', 'Deployment']) } });
    const out: { project: string; deployment: string; service: string; availability: number | null; target: number }[] =
      [];

    for (const d of this.planner.parse(resources).parsed)
      for (const s of d.compose.services.filter((x) => x.slo?.availability !== undefined && x.http.length)) {
        const counts = await this.requests(
          'lw_metrics_1h',
          'bucket',
          [...new Set(s.http.map((h) => h.host))],
          from,
          to,
        );

        out.push({
          project: d.project,
          deployment: d.name,
          service: s.name,
          availability: counts.total > 0 ? (counts.good / counts.total) * 100 : null,
          target: s.slo?.availability as number,
        });
      }

    return out;
  }

  private async evaluate(
    project: string,
    deployment: string,
    service: string,
    hosts: string[],
    slo: SloSpec,
    now: number,
  ): Promise<SloDto> {
    const from = new Date(now - WINDOW_DAYS[slo.window] * 86_400_000);
    const monthStart = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1));
    const hourAgo = new Date(now - 3_600_000);
    const out: SloDto = {
      project,
      deployment,
      service,
      hosts,
      window: slo.window,
      monthlyUptime: null,
      state: 'no-data',
    };
    const states: ObjectiveStatus['state'][] = [];

    if (slo.availability !== undefined) {
      const window = await this.requests('lw_metrics_1h', 'bucket', hosts, from);
      const lastHour = await this.requests('lw_metrics', 'time', hosts, hourAgo);
      const month = await this.requests('lw_metrics_1h', 'bucket', hosts, monthStart);

      out.availability = objectiveStatus(slo.availability, window, lastHour);
      out.monthlyUptime = month.total > 0 ? (month.good / month.total) * 100 : null;
      states.push(out.availability.state);
    }

    if (slo.latency) {
      const metric = `ingress.latency_${slo.latency.percentile}_ms`;
      const minutes = await this.latencyMinutes(metric, hosts, from);
      const lastHour = minutes.filter((m) => m.at >= hourAgo.getTime());

      out.latency = {
        ...objectiveStatus(
          slo.latency.target,
          latencyCounts(minutes, slo.latency.thresholdMs),
          latencyCounts(lastHour, slo.latency.thresholdMs),
        ),
        percentile: slo.latency.percentile,
        thresholdMs: slo.latency.thresholdMs,
      };
      states.push(out.latency.state);
    }

    out.state = worstObjective(states);

    return out;
  }

  private hostWhere(hosts: string[], params: unknown[]): string {
    const clauses = hosts.map((h) => {
      const p = hostPattern(h);

      params.push(p.value);

      return p.like ? `entity LIKE $${params.length}` : `entity = $${params.length}`;
    });

    return `(${clauses.join(' OR ')})`;
  }

  /** Requests and server errors since `from` (all ingress nodes' samples).*/
  private async requests(
    table: 'lw_metrics' | 'lw_metrics_1h',
    time: 'time' | 'bucket',
    hosts: string[],
    from: Date,
    to: Date = new Date(8.64e15),
  ): Promise<{ good: number; total: number }> {
    const params: unknown[] = [from, to];
    // The sum of all 10 s samples' rates (roll-ups: average × number of samples).
    const value = table === 'lw_metrics' ? 'value' : 'avg * samples';
    const rows: { metric: string; v: string }[] = await this.dataSource.query(
      `SELECT metric, sum(${value}) AS v FROM "${table}"
       WHERE "${time}" >= $1 AND "${time}" < $2 AND metric IN ('ingress.requests_per_s', 'ingress.errors_per_s')
         AND ${this.hostWhere(hosts, params)}
       GROUP BY metric`,
      params,
    );
    const total = Number(rows.find((r) => r.metric === 'ingress.requests_per_s')?.v ?? 0);
    const errors = Number(rows.find((r) => r.metric === 'ingress.errors_per_s')?.v ?? 0);

    return countsFromRates({ requests: total, errors }, SAMPLE_SECONDS);
  }

  /** Per minute with traffic: the worst ingress node's latency percentile. */
  private async latencyMinutes(
    metric: string,
    hosts: string[],
    from: Date,
  ): Promise<{ at: number; latencyMs: number }[]> {
    const params: unknown[] = [from, metric];
    const rows: { bucket: Date; v: string }[] = await this.dataSource.query(
      `SELECT bucket, max(max) AS v FROM lw_metrics_1m
       WHERE bucket >= $1 AND metric = $2 AND ${this.hostWhere(hosts, params)}
       GROUP BY bucket ORDER BY bucket LIMIT 50000`,
      params,
    );

    return rows.map((r) => ({ at: new Date(r.bucket).getTime(), latencyMs: Number(r.v) }));
  }
}
