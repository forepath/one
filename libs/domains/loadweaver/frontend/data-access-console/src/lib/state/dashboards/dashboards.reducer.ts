import { createReducer, on } from '@ngrx/store';

import type { DashboardFilter, DashboardQueryResult, DashboardResource } from '../../types/metrics.types';
import {
  dashboardWidgetFailure,
  dashboardWidgetSuccess,
  loadDashboards,
  loadDashboardsFailure,
  loadDashboardsSuccess,
  runDashboard,
} from './dashboards.actions';

export interface DashboardWidgetState {
  loading: boolean;
  result: DashboardQueryResult | null;
  error: string | null;
}

export interface ConsoleDashboardsState {
  dashboards: DashboardResource[];
  loading: boolean;
  error: string | null;
  selectedKey: string | null;
  filter: DashboardFilter | null;
  /** Per widget index of the selected dashboard. */
  widgets: Record<number, DashboardWidgetState>;
}

export const initialConsoleDashboardsState: ConsoleDashboardsState = {
  dashboards: [],
  loading: false,
  error: null,
  selectedKey: null,
  filter: null,
  widgets: {},
};

/** `<project>/<name>`, or `/<name>` for a cluster-wide dashboard. */
export function dashboardKey(dashboard: DashboardResource): string {
  return `${dashboard.metadata.project ?? ''}/${dashboard.metadata.name}`;
}

export const consoleDashboardsReducer = createReducer(
  initialConsoleDashboardsState,
  on(loadDashboards, (state) => ({ ...state, loading: true, error: null })),
  on(loadDashboardsSuccess, (state, { dashboards }) => ({ ...state, dashboards, loading: false })),
  on(loadDashboardsFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(runDashboard, (state, { key, filter }) => {
    const dashboard = state.dashboards.find((d) => dashboardKey(d) === key);
    const widgets: Record<number, DashboardWidgetState> = {};

    // A re-run keeps the shown results until the new ones arrive.
    (dashboard?.spec.widgets ?? []).forEach((_, index) => {
      widgets[index] = {
        loading: true,
        result: key === state.selectedKey ? (state.widgets[index]?.result ?? null) : null,
        error: null,
      };
    });

    return { ...state, selectedKey: key, filter, widgets };
  }),
  on(dashboardWidgetSuccess, (state, { key, index, result }) =>
    key === state.selectedKey
      ? { ...state, widgets: { ...state.widgets, [index]: { loading: false, result, error: null } } }
      : state,
  ),
  on(dashboardWidgetFailure, (state, { key, index, error }) =>
    key === state.selectedKey
      ? { ...state, widgets: { ...state.widgets, [index]: { loading: false, result: null, error } } }
      : state,
  ),
);
