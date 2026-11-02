import type { ConsoleLogLevel, ConsoleLogSource, LogLine } from './logs.types';

/** Metrics, flows, events (3.18) and `Dashboard` resources with the dashboard query builder. */

export type MetricGroupBy = 'entity' | 'node' | 'project' | 'none';
export type MetricAggregation = 'avg' | 'min' | 'max' | 'sum';

/** `GET /metrics/query`. */
export interface MetricQuery {
  metric: string;
  from?: string;
  to?: string;
  /** Exact entity or a prefix ending in `*`. */
  entity?: string;
  node?: string;
  project?: string;
  groupBy?: MetricGroupBy;
  aggregation?: MetricAggregation;
}

/** One series: `points` are `[ISO time, value]`. */
export interface MetricSeries {
  key: string;
  points: [string, number][];
}

/** `step` names the resolution (`10 seconds`, `1 minute`, `1 hour`); up to 200 series. */
export interface MetricResult {
  step: string;
  series: MetricSeries[];
}

/** `GET /metrics/events`: markers (applies, rollbacks, …), newest first. */
export interface MetricEvent {
  id: string;
  time: string;
  kind: string;
  entity: string;
  project: string | null;
  message: string;
}

export interface MetricEventQuery {
  from?: string;
  to?: string;
  kind?: string;
  project?: string;
  limit?: number;
}

/** A row of `GET /metrics/flows` (cluster roles). */
export interface FlowRow {
  policy: string;
  src: string;
  dst: string;
  protocol: string;
  port: number;
  decision: string;
  packets: number;
  bytes: number;
}

/** A query-builder query: exactly one of metrics, flows or logs. */
export type DashboardQuery =
  | {
      metrics: {
        metric: string;
        entity?: string;
        node?: string;
        aggregation?: MetricAggregation;
        groupBy?: MetricGroupBy;
      };
    }
  | {
      flows: { decision?: 'allowed' | 'denied' | 'observed'; node?: string; policy?: string; limit?: number };
    }
  | {
      logs: {
        sources?: ConsoleLogSource[];
        levels?: ConsoleLogLevel[];
        text?: string;
        service?: string;
        deployment?: string;
        limit?: number;
      };
    };

export type DashboardWidgetType = 'line' | 'area' | 'bar' | 'stat' | 'table' | 'logs';

/** A widget on the 12-column grid (`x` 0–11, `y` rows from the top). */
export interface DashboardWidget {
  title: string;
  type: DashboardWidgetType;
  query: DashboardQuery;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  unit?: string;
}

export interface DashboardSpec {
  title: string;
  description?: string;
  /** Default time range, a duration like `6h`, `7d`. */
  range?: string;
  widgets: DashboardWidget[];
}

/** A `Dashboard` resource (`GET /resources?kind=Dashboard`); cluster-wide without `metadata.project`. */
export interface DashboardResource {
  apiVersion: string;
  kind: 'Dashboard';
  metadata: { name: string; project?: string | null; [key: string]: unknown };
  spec: DashboardSpec;
}

/** `POST /dashboards/query`: one widget query within the global filter. */
export interface DashboardQueryRequest {
  query: DashboardQuery;
  from?: string;
  to?: string;
  project?: string;
}

export type DashboardQueryResult =
  | ({ kind: 'series' } & MetricResult)
  | { kind: 'flows'; rows: FlowRow[] }
  | { kind: 'logs'; lines: LogLine[] };

/** The global filter a dashboard is shown with. */
export interface DashboardFilter {
  from: string;
  to: string;
  project?: string;
}
