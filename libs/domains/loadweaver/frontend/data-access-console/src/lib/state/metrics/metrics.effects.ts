import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { MetricsService } from '../../services/metrics.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  loadMetricEventsSuccess,
  loadMetricNames,
  loadMetricNamesFailure,
  loadMetricNamesSuccess,
  queryMetrics,
  queryMetricsFailure,
  queryMetricsSuccess,
} from './metrics.actions';

export const loadMetricNames$ = createEffect(
  (actions$ = inject(Actions), service = inject(MetricsService)) =>
    actions$.pipe(
      ofType(loadMetricNames),
      switchMap(() =>
        service.names().pipe(
          map((names) => loadMetricNamesSuccess({ names })),
          catchError((error: unknown) =>
            of(loadMetricNamesFailure({ error: apiErrorMessage(error, 'Failed to load the metric names') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const queryMetrics$ = createEffect(
  (actions$ = inject(Actions), service = inject(MetricsService)) =>
    actions$.pipe(
      ofType(queryMetrics),
      switchMap(({ query }) =>
        service.query(query).pipe(
          map((result) => queryMetricsSuccess({ query, result })),
          catchError((error: unknown) =>
            of(queryMetricsFailure({ error: apiErrorMessage(error, 'Failed to load the metric') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Event markers for the queried range; without them the graph still shows (markers are optional). */
export const loadMetricEvents$ = createEffect(
  (actions$ = inject(Actions), service = inject(MetricsService)) =>
    actions$.pipe(
      ofType(queryMetrics),
      switchMap(({ query }) =>
        service.events({ from: query.from, to: query.to, project: query.project, limit: 200 }).pipe(
          map((events) => loadMetricEventsSuccess({ events })),
          catchError(() => of(loadMetricEventsSuccess({ events: [] }))),
        ),
      ),
    ),
  { functional: true },
);
