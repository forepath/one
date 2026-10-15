/**
 * Shared ApexCharts options for the consoles.
 *
 * All colours are Bootstrap CSS variables. ApexCharts 5 resolves series colours when it renders
 * and keeps text colours as live `var()` attributes, so charts pick up the brand palette and
 * follow light/dark mode (brand colours are identical in both themes). Charts have no ApexCharts
 * title; the surrounding `fpc-panel` header names them. Chrome that ApexCharts
 * styles itself (tooltips, slice borders, markers, grid lines) is themed in `styles/_charts.scss`.
 *
 * The objects are structurally compatible with the `ng-apexcharts` option types, so this library
 * does not need to depend on ApexCharts.
 */

export type FpcChartType = 'area' | 'line' | 'bar' | 'donut' | 'pie';

const FONT_FAMILY = 'var(--bs-body-font-family)';
const BORDER_COLOR = 'var(--bs-border-color)';

/**
 * Categorical palette: brand primary first, neutral secondary last. Charts whose series carry a
 * meaning (allowed / blocked, accepted / declined) pick semantic colours directly instead.
 */
export const FPC_CHART_COLORS = [
  'var(--bs-primary)',
  'var(--bs-info)',
  'var(--bs-success)',
  'var(--bs-warning)',
  'var(--bs-danger)',
  'var(--bs-secondary)',
] as const;

/** Colour for a single-slice placeholder (e.g. a donut with no data yet). */
export const FPC_CHART_PLACEHOLDER_COLOR = 'var(--bs-secondary)';

/** Palette colour for the series at `index`, cycling when there are more series than colours. */
export function fpcChartColor(index: number): string {
  return FPC_CHART_COLORS[index % FPC_CHART_COLORS.length];
}

/** `count` palette colours, cycling as needed. */
export function fpcChartColors(count: number): string[] {
  return Array.from({ length: Math.max(count, 0) }, (_, index) => fpcChartColor(index));
}

/** Base `chart` option: transparent background, body font, no toolbar or zoom. */
export function fpcChart(type: FpcChartType, height: number, extra: { stacked?: boolean } = {}) {
  return {
    type,
    height,
    background: 'transparent',
    foreColor: 'var(--bs-secondary-color)',
    fontFamily: FONT_FAMILY,
    toolbar: { show: false },
    zoom: { enabled: false },
    ...extra,
  };
}

/** Axis tick label style (`xaxis.labels.style` / `yaxis.labels.style`). */
export const FPC_CHART_LABEL_STYLE = { colors: 'var(--bs-secondary-color)', fontFamily: FONT_FAMILY };

/** Axis line and tick colours for `xaxis`. */
export const FPC_CHART_AXIS = {
  axisBorder: { color: BORDER_COLOR },
  axisTicks: { color: BORDER_COLOR },
};

export const FPC_CHART_GRID = { borderColor: BORDER_COLOR };

export const FPC_CHART_LEGEND = { fontFamily: FONT_FAMILY, labels: { colors: 'var(--bs-body-color)' } };

/** Percentage labels on donut / pie slices: white on the saturated brand colours, no shadow. */
export const FPC_CHART_SLICE_LABELS = {
  style: { colors: ['#fff'], fontFamily: FONT_FAMILY, fontWeight: 600 },
  dropShadow: { enabled: false },
};

/**
 * Donut / pie tooltip: ApexCharts paints it in the slice colour by default. Use the themed panel
 * from `styles/_charts.scss` instead, like every other chart.
 */
export const FPC_CHART_SLICE_TOOLTIP = { fillSeriesColor: false };

/** Area fill: soft vertical fade of the series colour that works on light and dark surfaces. */
export const FPC_CHART_AREA_FILL = {
  type: 'gradient',
  gradient: { shadeIntensity: 0, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 100] },
};
