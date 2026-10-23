import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, EMPTY, from, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { DashboardsService } from '../../services/dashboards.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  dashboardWidgetFailure,
  dashboardWidgetSuccess,
  loadDashboards,
  loadDashboardsFailure,
  loadDashboardsSuccess,
  runDashboard,
} from './dashboards.actions';
import { dashboardKey } from './dashboards.reducer';
import { selectConsoleDashboardsState } from './dashboards.selectors';

/** Widget queries in flight at once. */
const WIDGET_CONCURRENCY = 4;

export const loadDashboards$ = createEffect(
  (actions$ = inject(Actions), service = inject(DashboardsService)) =>
    actions$.pipe(
      ofType(loadDashboards),
      switchMap(() =>
        service.list().pipe(
          map((dashboards) => loadDashboardsSuccess({ dashboards })),
          catchError((error: unknown) =>
            of(loadDashboardsFailure({ error: apiErrorMessage(error, 'Failed to load the dashboards') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Runs every widget's query in the dashboard's filter; a new run cancels the previous one. */
export const runDashboard$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), service = inject(DashboardsService)) =>
    actions$.pipe(
      ofType(runDashboard),
      withLatestFrom(store.select(selectConsoleDashboardsState)),
      switchMap(([{ key, filter }, state]) => {
        const dashboard = state.dashboards.find((d) => dashboardKey(d) === key);

        if (!dashboard) return EMPTY;

        return from(dashboard.spec.widgets.map((widget, index) => ({ widget, index }))).pipe(
          mergeMap(
            ({ widget, index }) =>
              service
                .query({
                  query: widget.query,
                  from: filter.from,
                  to: filter.to,
                  ...(filter.project ? { project: filter.project } : {}),
                })
                .pipe(
                  map((result) => dashboardWidgetSuccess({ key, index, result })),
                  catchError((error: unknown) =>
                    of(dashboardWidgetFailure({ key, index, error: apiErrorMessage(error, 'Query failed') })),
                  ),
                ),
            WIDGET_CONCURRENCY,
          ),
        );
      }),
    ),
  { functional: true },
);
