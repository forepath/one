import { createAction, props } from '@ngrx/store';

import type { DashboardFilter, DashboardQueryResult, DashboardResource } from '../../types/metrics.types';

export const loadDashboards = createAction('[ConsoleDashboards] Load');
export const loadDashboardsSuccess = createAction(
  '[ConsoleDashboards] Load Success',
  props<{ dashboards: DashboardResource[] }>(),
);
export const loadDashboardsFailure = createAction('[ConsoleDashboards] Load Failure', props<{ error: string }>());

/** Shows a dashboard (`key`: `<project>/<name>` or `/<name>` cluster-wide) and runs its widgets in the filter. */
export const runDashboard = createAction('[ConsoleDashboards] Run', props<{ key: string; filter: DashboardFilter }>());
export const dashboardWidgetSuccess = createAction(
  '[ConsoleDashboards] Widget Success',
  props<{ key: string; index: number; result: DashboardQueryResult }>(),
);
export const dashboardWidgetFailure = createAction(
  '[ConsoleDashboards] Widget Failure',
  props<{ key: string; index: number; error: string }>(),
);
