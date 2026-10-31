import type { MetricEvent, MetricSeries } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FPC_CHART_AREA_FILL,
  FPC_CHART_AXIS,
  FPC_CHART_GRID,
  FPC_CHART_LABEL_STYLE,
  FPC_CHART_LEGEND,
  fpcChart,
  fpcChartColors,
} from '@forepath/shared/frontend/ui-components';

import { formatBytes } from '../overview/console-format';

/** Relative ranges of the metrics views. */
export type MetricRange = '15m' | '1h' | '6h' | '24h' | '7d' | '30d';

export const METRIC_RANGES: MetricRange[] = ['15m', '1h', '6h', '24h', '7d', '30d'];

/** A duration like `30s`, `5m`, `6h`, `7d` in ms (0 when invalid). */
export function durationMs(value: string | null | undefined): number {
  const match = /^(\d{1,6})(s|m|h|d)$/.exec(value ?? '');

  if (!match) return 0;

  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];

  return Number(match[1]) * unit;
}

/** One name segment of a replica id (no `/`, no `*`, no blanks). */
const ENTITY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/**
 * The metrics `entity` filter for a deployment (or one of its services): replica metrics carry the replica id
 * `<project>/<deployment>/<service>/<index>` as their entity, so the filter is that prefix with the API's trailing `*`.
 * `''` (no filter) when a part is missing or no valid name. The API still applies the caller's project scope.
 */
export function workloadMetricsEntity(
  project: string | null | undefined,
  deployment: string,
  service?: string,
): string {
  const parts = [project ?? '', deployment, ...(service !== undefined ? [service] : [])];

  return parts.every((part) => ENTITY_SEGMENT.test(part)) ? `${parts.join('/')}/*` : '';
}

export function metricRangeLabel(range: string): string {
  switch (range) {
    case '15m':
      return $localize`:@@lwConsoleMetrics-range15m:Last 15 minutes`;
    case '1h':
      return $localize`:@@lwConsoleMetrics-range1h:Last hour`;
    case '6h':
      return $localize`:@@lwConsoleMetrics-range6h:Last 6 hours`;
    case '24h':
      return $localize`:@@lwConsoleMetrics-range24h:Last 24 hours`;
    case '7d':
      return $localize`:@@lwConsoleMetrics-range7d:Last 7 days`;
    case '30d':
      return $localize`:@@lwConsoleMetrics-range30d:Last 30 days`;
    default:
      return $localize`:@@lwConsoleMetrics-rangeOther:Last ${range}:range:`;
  }
}

/** `from` / `to` of a relative range ending now. */
export function rangeWindow(range: string, now = Date.now()): { from: string; to: string } {
  return { from: new Date(now - (durationMs(range) || 3_600_000)).toISOString(), to: new Date(now).toISOString() };
}

/** The unit of a metric by its name when a widget doesn't give one (`*_bytes` → bytes). */
export function metricUnit(metric: string | null | undefined): string | undefined {
  if (!metric) return undefined;

  if (/_bytes_per_s$/.test(metric)) return 'bytes/s';

  if (/_bytes$/.test(metric)) return 'bytes';

  if (/_ms$/.test(metric)) return 'ms';

  if (/_per_s$/.test(metric)) return '/s';

  if (/_s$/.test(metric)) return 's';

  if (/_cores$/.test(metric)) return 'cores';

  if (/_ratio$/.test(metric)) return 'ratio';

  return undefined;
}

/** A unit for display (en / de); unknown units as they are. */
export function metricUnitLabel(unit: string): string {
  switch (unit) {
    case 'cores':
      return $localize`:@@lwConsoleMetrics-unitCores:cores`;
    default:
      return unit;
  }
}

/** A value with its unit; bytes in binary units. */
export function formatMetricValue(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';

  if (unit === 'bytes') return formatBytes(value);

  if (unit === 'bytes/s') return `${formatBytes(value)}/s`;

  if (unit === 'ratio') return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })} %`;

  const number =
    Math.abs(value) >= 100 || Number.isInteger(value)
      ? Math.round(value).toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return unit ? `${number} ${metricUnitLabel(unit)}` : number;
}

/** The newest value per series (`stat` widgets, tables of series). */
export function latestValues(series: readonly MetricSeries[]): { key: string; value: number | null }[] {
  return series.map((s) => ({ key: s.key, value: s.points.length > 0 ? s.points[s.points.length - 1][1] : null }));
}

/** One number for a stat: the single series' newest value, else the sum of the newest values. */
export function statValue(series: readonly MetricSeries[]): number | null {
  const values = latestValues(series)
    .map((v) => v.value)
    .filter((v): v is number => v !== null);

  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0);
}

export type MetricChartType = 'line' | 'area' | 'bar';

const CHART_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * HTML-escapes text from API data before ApexCharts gets it: the legend and the tooltip put series names and tooltip
 * values in with `innerHTML`. (Axis and annotation labels are SVG text nodes, set as plain text — escaping them would
 * show the entities.)
 */
export function escapeChartText(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => CHART_ESCAPES[char]);
}

/** ApexCharts options for time series (shared chart theme), event markers as x-axis annotations. */
export function metricChartOptions(
  type: MetricChartType,
  series: readonly MetricSeries[],
  options: {
    height?: number;
    unit?: string;
    events?: readonly MetricEvent[];
    seriesLabel?: (key: string) => string;
  } = {},
) {
  const unit = options.unit;

  return {
    series: series.map((s) => ({
      name: escapeChartText(options.seriesLabel ? options.seriesLabel(s.key) : s.key),
      data: s.points.map(([time, value]) => [Date.parse(time), value]),
    })),
    chart: { ...fpcChart(type, options.height ?? 280), animations: { enabled: false } },
    colors: fpcChartColors(Math.max(series.length, 1)),
    stroke: { curve: 'smooth' as const, width: type === 'bar' ? 0 : 2 },
    fill: type === 'area' ? FPC_CHART_AREA_FILL : { type: 'solid', opacity: type === 'bar' ? 0.85 : 1 },
    dataLabels: { enabled: false },
    xaxis: {
      ...FPC_CHART_AXIS,
      type: 'datetime' as const,
      labels: { style: FPC_CHART_LABEL_STYLE, datetimeUTC: false },
    },
    yaxis: {
      labels: { style: FPC_CHART_LABEL_STYLE, formatter: (value: number) => formatMetricValue(value, unit) },
    },
    grid: FPC_CHART_GRID,
    legend: { ...FPC_CHART_LEGEND, show: series.length > 1 && series.length <= 20 },
    tooltip: {
      x: { format: 'dd MMM HH:mm:ss' },
      y: { formatter: (value: number) => escapeChartText(formatMetricValue(value, unit)) },
    },
    annotations: {
      xaxis: (options.events ?? []).map((event) => ({
        x: Date.parse(event.time),
        borderColor: 'var(--bs-warning)',
        strokeDashArray: 4,
        label: {
          // An SVG text node (plain text in ApexCharts), not HTML.
          text: metricEventKindLabel(event.kind),
          orientation: 'horizontal',
          borderColor: 'var(--bs-warning)',
          style: { background: 'var(--bs-warning-bg-subtle)', color: 'var(--bs-body-color)' },
        },
      })),
    },
  };
}

export type MetricChartOptions = ReturnType<typeof metricChartOptions>;

/** Categories of the metrics overview, in display order. */
export type MetricCategory = 'nodes' | 'workloads' | 'virtualMachines' | 'ingress' | 'network' | 'other';

export const METRIC_CATEGORIES: readonly MetricCategory[] = [
  'nodes',
  'workloads',
  'virtualMachines',
  'ingress',
  'network',
  'other',
];

/** A chart of the metrics overview; `summary` puts its newest value into the summary bar (sum or max of series). */
export interface MetricDefinition {
  metric: string;
  category: MetricCategory;
  chart: MetricChartType;
  summary?: 'sum' | 'max';
}

/** The metrics the node agents report (3.18), grouped; unknown names land in "Other". */
export const METRIC_CATALOG: readonly MetricDefinition[] = [
  { metric: 'node.cpu_cores', category: 'nodes', chart: 'line', summary: 'sum' },
  { metric: 'node.memory_bytes', category: 'nodes', chart: 'area', summary: 'sum' },
  { metric: 'node.disk_bytes', category: 'nodes', chart: 'area', summary: 'sum' },
  { metric: 'node.containers', category: 'nodes', chart: 'line', summary: 'sum' },
  { metric: 'node.vmroot_cache_bytes', category: 'nodes', chart: 'area' },
  { metric: 'node.vmroot_layers', category: 'nodes', chart: 'line' },
  { metric: 'replica.cpu_cores', category: 'workloads', chart: 'line', summary: 'sum' },
  { metric: 'replica.memory_bytes', category: 'workloads', chart: 'area', summary: 'sum' },
  { metric: 'replica.net_rx_bytes_per_s', category: 'workloads', chart: 'line' },
  { metric: 'replica.net_tx_bytes_per_s', category: 'workloads', chart: 'line' },
  { metric: 'replica.guest_memory_used_bytes', category: 'virtualMachines', chart: 'area' },
  { metric: 'replica.guest_memory_total_bytes', category: 'virtualMachines', chart: 'line' },
  { metric: 'replica.guest_cpu_steal_ratio', category: 'virtualMachines', chart: 'line' },
  { metric: 'replica.guest_load1', category: 'virtualMachines', chart: 'line' },
  { metric: 'ingress.requests_per_s', category: 'ingress', chart: 'line', summary: 'sum' },
  { metric: 'ingress.errors_per_s', category: 'ingress', chart: 'line', summary: 'sum' },
  { metric: 'ingress.latency_p50_ms', category: 'ingress', chart: 'line' },
  { metric: 'ingress.latency_p95_ms', category: 'ingress', chart: 'line', summary: 'max' },
  { metric: 'ingress.latency_p99_ms', category: 'ingress', chart: 'line' },
  { metric: 'net.rx_bytes_per_s', category: 'network', chart: 'line' },
  { metric: 'net.tx_bytes_per_s', category: 'network', chart: 'line' },
  { metric: 'wg.rx_bytes_per_s', category: 'network', chart: 'line' },
  { metric: 'wg.tx_bytes_per_s', category: 'network', chart: 'line' },
  { metric: 'wg.handshake_age_s', category: 'network', chart: 'line' },
];

/** Usage-metering counters (3.24): they belong to the usage page, not to the live overview. */
export const METERING_METRICS: ReadonlySet<string> = new Set([
  'replica.cpu_seconds',
  'replica.memory_byte_seconds',
  'replica.net_rx_bytes',
  'replica.net_tx_bytes',
]);

/** The catalog entry of a metric (unknown names: "Other", line chart). */
export function metricDefinition(metric: string): MetricDefinition {
  return METRIC_CATALOG.find((d) => d.metric === metric) ?? { metric, category: 'other', chart: 'line' };
}

/** The overview's charts: the catalog's order first, then unknown names (A–Z); metering counters left out. */
export function overviewMetrics(names: readonly string[]): MetricDefinition[] {
  const known = new Set(names);
  const catalog = METRIC_CATALOG.filter((d) => known.has(d.metric));
  const other = [...known]
    .filter((name) => !METERING_METRICS.has(name) && !METRIC_CATALOG.some((d) => d.metric === name))
    .sort()
    .map((name) => metricDefinition(name));

  return [...catalog, ...other];
}

/** The newest value per series combined: the sum, or the largest (latencies). */
export function summaryValue(series: readonly MetricSeries[], mode: 'sum' | 'max'): number | null {
  if (mode === 'sum') return statValue(series);

  const values = latestValues(series)
    .map((v) => v.value)
    .filter((v): v is number => v !== null);

  return values.length === 0 ? null : Math.max(...values);
}

export function metricCategoryLabel(category: MetricCategory): string {
  switch (category) {
    case 'nodes':
      return $localize`:@@lwConsoleMetrics-catNodes:Nodes`;
    case 'workloads':
      return $localize`:@@lwConsoleMetrics-catWorkloads:Workloads`;
    case 'virtualMachines':
      return $localize`:@@lwConsoleMetrics-catVms:Virtual machines`;
    case 'ingress':
      return $localize`:@@lwConsoleMetrics-catIngress:Ingress`;
    case 'network':
      return $localize`:@@lwConsoleMetrics-catNetwork:Network`;
    default:
      return $localize`:@@lwConsoleMetrics-catOther:Other`;
  }
}

/** A metric name for people (en / de); unknown names as they are. */
export function metricLabel(metric: string): string {
  switch (metric) {
    case 'node.cpu_cores':
      return $localize`:@@lwConsoleMetrics-mNodeCpu:Node CPU`;
    case 'node.memory_bytes':
      return $localize`:@@lwConsoleMetrics-mNodeMemory:Node memory`;
    case 'node.disk_bytes':
      return $localize`:@@lwConsoleMetrics-mNodeDisk:Node disk`;
    case 'node.containers':
      return $localize`:@@lwConsoleMetrics-mContainers:Containers`;
    case 'node.vmroot_cache_bytes':
      return $localize`:@@lwConsoleMetrics-mImageCache:Image cache size`;
    case 'node.vmroot_layers':
      return $localize`:@@lwConsoleMetrics-mImageLayers:Image cache layers`;
    case 'replica.cpu_cores':
      return $localize`:@@lwConsoleMetrics-mWorkloadCpu:Workload CPU`;
    case 'replica.memory_bytes':
      return $localize`:@@lwConsoleMetrics-mWorkloadMemory:Workload memory`;
    case 'replica.net_rx_bytes_per_s':
      return $localize`:@@lwConsoleMetrics-mWorkloadRx:Workload traffic in`;
    case 'replica.net_tx_bytes_per_s':
      return $localize`:@@lwConsoleMetrics-mWorkloadTx:Workload traffic out`;
    case 'replica.guest_memory_used_bytes':
      return $localize`:@@lwConsoleMetrics-mGuestMemoryUsed:Guest memory used`;
    case 'replica.guest_memory_total_bytes':
      return $localize`:@@lwConsoleMetrics-mGuestMemoryTotal:Guest memory total`;
    case 'replica.guest_cpu_steal_ratio':
      return $localize`:@@lwConsoleMetrics-mGuestSteal:Guest CPU steal`;
    case 'replica.guest_load1':
      return $localize`:@@lwConsoleMetrics-mGuestLoad:Guest load (1 min)`;
    case 'ingress.requests_per_s':
      return $localize`:@@lwConsoleMetrics-mRequests:Requests`;
    case 'ingress.errors_per_s':
      return $localize`:@@lwConsoleMetrics-mErrors:Errors`;
    case 'ingress.latency_p50_ms':
      return $localize`:@@lwConsoleMetrics-mLatencyP50:Latency p50`;
    case 'ingress.latency_p95_ms':
      return $localize`:@@lwConsoleMetrics-mLatencyP95:Latency p95`;
    case 'ingress.latency_p99_ms':
      return $localize`:@@lwConsoleMetrics-mLatencyP99:Latency p99`;
    case 'net.rx_bytes_per_s':
      return $localize`:@@lwConsoleMetrics-mNetRx:Node traffic in`;
    case 'net.tx_bytes_per_s':
      return $localize`:@@lwConsoleMetrics-mNetTx:Node traffic out`;
    case 'wg.rx_bytes_per_s':
      return $localize`:@@lwConsoleMetrics-mTunnelRx:Tunnel traffic in`;
    case 'wg.tx_bytes_per_s':
      return $localize`:@@lwConsoleMetrics-mTunnelTx:Tunnel traffic out`;
    case 'wg.handshake_age_s':
      return $localize`:@@lwConsoleMetrics-mHandshakeAge:Tunnel handshake age`;
    default:
      return metric;
  }
}

/** An aggregation for people (en / de). */
export function aggregationLabel(aggregation: string): string {
  switch (aggregation) {
    case 'avg':
      return $localize`:@@lwConsoleMetrics-aggAvg:Average`;
    case 'min':
      return $localize`:@@lwConsoleMetrics-aggMin:Minimum`;
    case 'max':
      return $localize`:@@lwConsoleMetrics-aggMax:Maximum`;
    case 'sum':
      return $localize`:@@lwConsoleMetrics-aggSum:Sum`;
    default:
      return aggregation;
  }
}

/** An event marker's kind for people (en / de); unknown kinds as they are. */
export function metricEventKindLabel(kind: string): string {
  switch (kind) {
    case 'plan':
      return $localize`:@@lwConsoleMetrics-eventPlan:Plan`;
    case 'health':
      return $localize`:@@lwConsoleMetrics-eventHealth:Health`;
    case 'drift':
      return $localize`:@@lwConsoleMetrics-eventDrift:Drift`;
    case 'info':
      return $localize`:@@lwConsoleMetrics-eventInfo:Info`;
    case 'warn':
      return $localize`:@@lwConsoleMetrics-eventWarn:Warning`;
    case 'error':
      return $localize`:@@lwConsoleMetrics-eventError:Error`;
    default:
      return kind;
  }
}

/** A flow decision for people (en / de). */
export function flowDecisionLabel(decision: string): string {
  switch (decision) {
    case 'allowed':
      return $localize`:@@lwConsoleMetrics-flowAllowed:Allowed`;
    case 'denied':
      return $localize`:@@lwConsoleMetrics-flowDenied:Denied`;
    case 'observed':
      return $localize`:@@lwConsoleMetrics-flowObserved:Observed`;
    default:
      return decision;
  }
}
