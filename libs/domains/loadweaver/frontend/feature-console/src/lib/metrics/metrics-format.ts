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

  return undefined;
}

/** A value with its unit; bytes in binary units. */
export function formatMetricValue(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';

  if (unit === 'bytes') return formatBytes(value);

  if (unit === 'bytes/s') return `${formatBytes(value)}/s`;

  const number =
    Math.abs(value) >= 100 || Number.isInteger(value)
      ? Math.round(value).toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return unit ? `${number} ${unit}` : number;
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
  options: { height?: number; unit?: string; events?: readonly MetricEvent[] } = {},
) {
  const unit = options.unit;

  return {
    series: series.map((s) => ({
      name: escapeChartText(s.key),
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
          text: event.kind,
          orientation: 'horizontal',
          borderColor: 'var(--bs-warning)',
          style: { background: 'var(--bs-warning-bg-subtle)', color: 'var(--bs-body-color)' },
        },
      })),
    },
  };
}

export type MetricChartOptions = ReturnType<typeof metricChartOptions>;
