import { fpcChartCategoryAxis, FPC_CHART_RESPONSIVE } from '@forepath/shared/frontend/ui-components';

/**
 * The one x-axis of Decabill's time / bucket charts (DB-17 a / DB-21): the shared category axis (unrotated, at most
 * `maxTicks` labels, thinned by the real plot width and re-thinned on resize, so phones don't overlap).
 */
export function billingChartTimeAxis(categories: readonly string[], maxTicks = 6) {
  return fpcChartCategoryAxis(categories, { maxTicks });
}

/** Responsive options bound on every Decabill chart (legend below, fewer ticks, min donut size on phones). */
export const BILLING_CHART_RESPONSIVE = FPC_CHART_RESPONSIVE;
