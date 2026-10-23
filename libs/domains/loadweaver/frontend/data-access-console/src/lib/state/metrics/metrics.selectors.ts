import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleMetricsState } from './metrics.reducer';

export const selectConsoleMetricsState = createFeatureSelector<ConsoleMetricsState>('consoleMetrics');

export const selectMetricNames = createSelector(selectConsoleMetricsState, (state) => state.names);
export const selectMetricNamesLoading = createSelector(selectConsoleMetricsState, (state) => state.namesLoading);
export const selectMetricNamesError = createSelector(selectConsoleMetricsState, (state) => state.namesError);
export const selectMetricQuery = createSelector(selectConsoleMetricsState, (state) => state.query);
export const selectMetricResult = createSelector(selectConsoleMetricsState, (state) => state.result);
export const selectMetricsLoading = createSelector(selectConsoleMetricsState, (state) => state.loading);
export const selectMetricsError = createSelector(selectConsoleMetricsState, (state) => state.error);
export const selectMetricEvents = createSelector(selectConsoleMetricsState, (state) => state.events);
