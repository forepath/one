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

// --- Chart defaults (X-07 / DB-17 / AG-08, 2026-10-29) ----------------------------------------------------------------

/**
 * Brand-independent categorical palette (8 hues, fixed order, validated for CVD / normal-vision separation in both
 * modes). Use it where series are identities (products, filters, kinds) and the brand palette would repeat a hue
 * (Decabill: primary = success = green). Assign in order, never cycle: a 9th series folds into "Other".
 */
export const FPC_CHART_CATEGORICAL_LIGHT = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
] as const;

/** The same eight hues stepped for the dark surface. */
export const FPC_CHART_CATEGORICAL_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as const;

/** `count` categorical colours (≤ 8, fixed order) for the current mode. */
export function fpcChartCategorical(count: number, dark = false): string[] {
  const palette = dark ? FPC_CHART_CATEGORICAL_DARK : FPC_CHART_CATEGORICAL_LIGHT;

  return palette.slice(0, Math.max(0, Math.min(count, palette.length)));
}

/**
 * `yaxis` for counts (messages, offers, events): whole-number ticks only (no 0.2 / 0.5 steps), at least 1 as the
 * maximum so an all-zero series doesn't render 0 … 0.
 */
export function fpcChartCountAxis(format: (value: number) => string = (value) => String(Math.round(value))) {
  return {
    min: 0,
    forceNiceScale: true,
    decimalsInFloat: 0,
    labels: {
      style: FPC_CHART_LABEL_STYLE,
      formatter: (value: number) => (Number.isInteger(value) ? format(value) : ''),
    },
  };
}

/**
 * `yaxis` for money: compact, locale-formatted ticks (`€25K` / `25.000 €` → `25 Tsd. €`) instead of `25000.00€`. Pass
 * the formatter from the app (e.g. `(v) => fpcFormatMoney(v, 'EUR', locale, { compact: true })`).
 */
export function fpcChartValueAxis(format: (value: number) => string) {
  return {
    forceNiceScale: true,
    labels: { style: FPC_CHART_LABEL_STYLE, formatter: (value: number) => format(value) },
  };
}

/**
 * `xaxis` for time / category buckets: unrotated labels, overlapping ones hidden and at most `maxTicks` labels
 * (default 8: a month of days shows ~weekly ticks instead of 31 rotated dates), plus the themed axis chrome.
 */
export function fpcChartTimeAxis(maxTicks = 8, format?: (value: string | number) => string) {
  return {
    ...FPC_CHART_AXIS,
    tickAmount: maxTicks,
    labels: {
      rotate: 0,
      hideOverlappingLabels: true,
      trim: true,
      style: FPC_CHART_LABEL_STYLE,
      ...(format ? { formatter: format } : {}),
    },
  };
}

/**
 * Minimum room per x-axis label of a category axis: a short date like "Oct 29" plus a generous gap. 64 px allowed ~14
 * labels on a desktop chart and read as crowded (DB-21 round 2); 110 px gives ~6 on desktop and 2–3 on phones.
 */
export const FPC_CHART_CATEGORY_LABEL_SPACING = 110;

/**
 * Which category labels to draw (X-07 / DB-21): every `step`-th index, so that at most `maxTicks` labels and no more
 * than one per `spacing` px of plot width are drawn. Pure; used by {@link fpcChartCategoryAxis} at render time.
 */
export function fpcChartCategoryStep(
  count: number,
  plotWidth: number,
  maxTicks = 8,
  spacing = FPC_CHART_CATEGORY_LABEL_SPACING,
): number {
  if (count <= 1) return 1;

  const fit = plotWidth > 0 ? Math.max(2, Math.floor(plotWidth / spacing)) : maxTicks;
  const ticks = Math.max(1, Math.min(maxTicks, fit));

  return Math.max(1, Math.ceil(count / ticks));
}

/**
 * `xaxis` for category buckets (days / weeks / months): unrotated labels thinned **at render time** from the real plot
 * width (`fpcChartCategoryStep`), so a phone plot shows a few labels that never touch and a resize re-thins them (the
 * `responsive` override and build-time `tickAmount` didn't reach category axes reliably). Tooltips keep every label.
 */
export function fpcChartCategoryAxis(
  categories: readonly string[],
  options: { maxTicks?: number; spacing?: number; format?: (value: string) => string } = {},
) {
  const { maxTicks = 6, spacing = FPC_CHART_CATEGORY_LABEL_SPACING, format = (value: string) => value } = options;
  const count = categories.length;

  return {
    ...FPC_CHART_AXIS,
    type: 'category' as const,
    categories: [...categories],
    tickPlacement: 'on' as const,
    // Fallback thinning where a chart renders labels without the index (and a cap for the render-time step below).
    tickAmount: Math.max(1, Math.min(maxTicks, count - 1)),
    labels: {
      rotate: 0,
      hideOverlappingLabels: true,
      trim: false,
      style: FPC_CHART_LABEL_STYLE,
      formatter: (value: string, _raw?: unknown, opts?: { i?: number; w?: { layout?: { gridWidth?: number } } }) => {
        const label = value === undefined || value === null ? '' : format(String(value));

        // Tooltip / other callers pass no label index: always the full label.
        if (typeof opts?.i !== 'number') return label;

        const step = fpcChartCategoryStep(count, opts.w?.layout?.gridWidth ?? 0, maxTicks, spacing);

        return opts.i % step === 0 ? label : '';
      },
    },
  };
}

/** Legend that stays inside its panel: scrolls instead of being cut off; below the chart on narrow panels. */
export const FPC_CHART_LEGEND_SCROLL = {
  ...FPC_CHART_LEGEND,
  position: 'bottom' as const,
  height: 72,
  itemMargin: { horizontal: 8, vertical: 2 },
};

/** Narrow widths (≤ 576 px): legend below, fewer ticks, a minimum donut size (DB-21 / AG-08). */
export const FPC_CHART_RESPONSIVE = [
  {
    breakpoint: 576,
    options: {
      legend: { position: 'bottom' },
      xaxis: { tickAmount: 4 },
      plotOptions: { pie: { donut: { size: '60%' } } },
      chart: { height: 280 },
    },
  },
];
