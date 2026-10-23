import { createFeatureSelector, createSelector } from '@ngrx/store';

import { dashboardKey, type ConsoleDashboardsState } from './dashboards.reducer';

export const selectConsoleDashboardsState = createFeatureSelector<ConsoleDashboardsState>('consoleDashboards');

/** Sorted by title. */
export const selectDashboards = createSelector(selectConsoleDashboardsState, (state) =>
  [...state.dashboards].sort((a, b) => (a.spec.title ?? '').localeCompare(b.spec.title ?? '')),
);
export const selectDashboardsLoading = createSelector(selectConsoleDashboardsState, (state) => state.loading);
export const selectDashboardsError = createSelector(selectConsoleDashboardsState, (state) => state.error);
export const selectSelectedDashboardKey = createSelector(selectConsoleDashboardsState, (state) => state.selectedKey);
export const selectSelectedDashboard = createSelector(
  selectConsoleDashboardsState,
  (state) => state.dashboards.find((d) => dashboardKey(d) === state.selectedKey) ?? null,
);
export const selectDashboardFilter = createSelector(selectConsoleDashboardsState, (state) => state.filter);
export const selectDashboardWidgets = createSelector(selectConsoleDashboardsState, (state) => state.widgets);
