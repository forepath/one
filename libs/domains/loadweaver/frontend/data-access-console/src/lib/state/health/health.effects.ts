import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { HealthService } from '../../services/health.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  loadHealthEntity,
  loadHealthEntityFailure,
  loadHealthEntitySuccess,
  loadHealthHistory,
  loadHealthHistoryFailure,
  loadHealthHistorySuccess,
  loadHealthTree,
  loadHealthTreeFailure,
  loadHealthTreeSuccess,
} from './health.actions';

export const loadHealthTree$ = createEffect(
  (actions$ = inject(Actions), service = inject(HealthService)) =>
    actions$.pipe(
      ofType(loadHealthTree),
      switchMap(({ project }) =>
        service.tree({ project }).pipe(
          map((entities) => loadHealthTreeSuccess({ entities })),
          catchError((error: unknown) =>
            of(loadHealthTreeFailure({ error: apiErrorMessage(error, 'Failed to load the health tree') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadHealthEntity$ = createEffect(
  (actions$ = inject(Actions), service = inject(HealthService)) =>
    actions$.pipe(
      ofType(loadHealthEntity),
      switchMap(({ key }) =>
        service.tree({ root: key }).pipe(
          map((entities) => loadHealthEntitySuccess({ key, entities })),
          catchError((error: unknown) =>
            of(loadHealthEntityFailure({ key, error: apiErrorMessage(error, 'Failed to load the entity') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadHealthHistory$ = createEffect(
  (actions$ = inject(Actions), service = inject(HealthService)) =>
    actions$.pipe(
      ofType(loadHealthHistory),
      switchMap(({ key, from, to }) =>
        service.history({ key, from, to }).pipe(
          map((history) => loadHealthHistorySuccess({ history })),
          catchError((error: unknown) =>
            of(loadHealthHistoryFailure({ key, error: apiErrorMessage(error, 'Failed to load the history') })),
          ),
        ),
      ),
    ),
  { functional: true },
);
