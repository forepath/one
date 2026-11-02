import type { RequestWithUser } from '@forepath/identity/backend';
import { dashboardQuerySchema, type DashboardQuery } from '@forepath/loadweaver/shared/util-model';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { LogsService, type LogLine } from '../logs/logs.service';
import { MetricsStore, type Series } from '../metrics/metrics.store';

/** One widget query within the global filter (time range and project, 3.18). */
export const dashboardQueryRequestSchema = z
  .object({
    query: dashboardQuerySchema,
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    project: z
      .string()
      .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
      .optional(),
  })
  .strict();
export type DashboardQueryRequest = z.infer<typeof dashboardQueryRequestSchema>;

export type DashboardQueryResult =
  | { kind: 'series'; step: string; series: Series[] }
  | { kind: 'flows'; rows: Awaited<ReturnType<MetricsStore['flows']>> }
  | { kind: 'logs'; lines: LogLine[] };

/** Grafana's SimpleJSON data source protocol (a Grafana-compatible data source, 3.18). */
/** Grafana sends ISO times. */
export const grafanaRangeSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

export const grafanaQuerySchema = z.object({
  range: grafanaRangeSchema,
  targets: z
    .array(
      z.object({
        target: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/),
        refId: z.string().max(16).optional(),
        payload: z
          .object({
            entity: z.string().max(255).optional(),
            node: z.string().max(63).optional(),
            project: z.string().max(63).optional(),
            aggregation: z.enum(['avg', 'min', 'max', 'sum']).optional(),
            groupBy: z.enum(['entity', 'node', 'project', 'none']).optional(),
          })
          .optional(),
      }),
    )
    .max(20),
});

/**
 * The dashboard query builder (3.18): runs one widget's query over metrics, flows or logs through the same scoped
 * services as the curated views, so a dashboard never shows more than its viewer may read.
 */
@Injectable()
export class DashboardQueryService {
  constructor(
    private readonly metrics: MetricsStore,
    private readonly logs: LogsService,
  ) {}

  async run(req: RequestWithUser | undefined, request: DashboardQueryRequest): Promise<DashboardQueryResult> {
    const { query, from, to, project } = request;

    return await this.dispatch(req, query, { from, to, project });
  }

  private async dispatch(
    req: RequestWithUser | undefined,
    query: DashboardQuery,
    filter: { from?: string; to?: string; project?: string },
  ): Promise<DashboardQueryResult> {
    if ('metrics' in query) {
      const m = query.metrics;
      const result = await this.metrics.query(req, {
        metric: m.metric,
        ...filter,
        ...(m.entity ? { entity: m.entity } : {}),
        ...(m.node ? { node: m.node } : {}),
        aggregation: m.aggregation,
        groupBy: m.groupBy,
      });

      return { kind: 'series', ...result };
    }

    if ('flows' in query) {
      const rows = await this.metrics.flows(req, { from: filter.from, to: filter.to, ...query.flows });

      return { kind: 'flows', rows };
    }

    const l = query.logs;
    const page = await this.logs.query(req, {
      ...filter,
      ...(l.sources ? { sources: l.sources } : {}),
      ...(l.levels ? { levels: l.levels } : {}),
      ...(l.text ? { text: l.text } : {}),
      ...(l.service ? { service: l.service } : {}),
      ...(l.deployment ? { deployment: l.deployment } : {}),
      limit: l.limit,
    });

    return { kind: 'logs', lines: page.lines };
  }

  /** SimpleJSON `/search`: the metric names the caller can query. */
  async grafanaSearch(req: RequestWithUser | undefined): Promise<string[]> {
    return await this.metrics.metricNames(req);
  }

  /** SimpleJSON `/query`: one time series per group, datapoints as `[value, epochMs]`. */
  async grafanaQuery(
    req: RequestWithUser | undefined,
    body: z.infer<typeof grafanaQuerySchema>,
  ): Promise<{ target: string; datapoints: [number, number][] }[]> {
    const out: { target: string; datapoints: [number, number][] }[] = [];

    for (const t of body.targets) {
      const result = await this.metrics.query(req, {
        metric: t.target,
        from: body.range.from,
        to: body.range.to,
        ...(t.payload ?? {}),
      });

      for (const s of result.series)
        out.push({
          target: result.series.length === 1 && s.key === 'all' ? t.target : `${t.target} ${s.key}`,
          datapoints: s.points.map(([time, value]) => [value, Date.parse(time)]),
        });
    }

    return out;
  }

  /** SimpleJSON `/annotations`: event markers (applies, failovers, ...) in the range. */
  async grafanaAnnotations(
    req: RequestWithUser | undefined,
    range: { from: string; to: string },
  ): Promise<{ time: number; title: string; text: string; tags: string[] }[]> {
    const events = await this.metrics.events(req, { from: range.from, to: range.to, limit: 500 });

    return events.map((e) => ({
      time: Date.parse(e.time),
      title: e.kind,
      text: e.message,
      tags: [e.kind, ...(e.project ? [e.project] : [])],
    }));
  }
}
