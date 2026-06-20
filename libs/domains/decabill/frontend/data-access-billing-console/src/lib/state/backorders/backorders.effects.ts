import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { BackordersService } from '../../services/backorders.service';

import {
  cancelBackorder,
  cancelBackorderFailure,
  cancelBackorderSuccess,
  loadBackorders,
  loadBackordersBatch,
  loadBackordersFailure,
  loadBackordersSuccess,
  retryBackorder,
  retryBackorderFailure,
  retryBackorderSuccess,
} from './backorders.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

const BATCH_SIZE = 10;

export const loadBackorders$ = createEffect(
  (actions$ = inject(Actions), backordersService = inject(BackordersService)) => {
    return actions$.pipe(
      ofType(loadBackorders),
      switchMap(({ params }) => {
        const batchParams = { limit: BATCH_SIZE, offset: 0, ...params };

        return backordersService.listBackorders(batchParams).pipe(
          switchMap((backorders) => {
            if (backorders.length === 0) return of(loadBackordersSuccess({ backorders: [] }));

            if (backorders.length < BATCH_SIZE) return of(loadBackordersSuccess({ backorders }));

            return of(loadBackordersBatch({ offset: BATCH_SIZE, accumulatedBackorders: backorders }));
          }),
          catchError((error) => of(loadBackordersFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadBackordersBatch$ = createEffect(
  (actions$ = inject(Actions), backordersService = inject(BackordersService)) => {
    return actions$.pipe(
      ofType(loadBackordersBatch),
      switchMap(({ offset, accumulatedBackorders }) => {
        const batchParams = { limit: BATCH_SIZE, offset };

        return backordersService.listBackorders(batchParams).pipe(
          switchMap((backorders) => {
            const newAccumulated = [...accumulatedBackorders, ...backorders];

            if (backorders.length === 0 || backorders.length < BATCH_SIZE) {
              return of(loadBackordersSuccess({ backorders: newAccumulated }));
            }

            return of(loadBackordersBatch({ offset: offset + BATCH_SIZE, accumulatedBackorders: newAccumulated }));
          }),
          catchError((error) => of(loadBackordersFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const retryBackorder$ = createEffect(
  (actions$ = inject(Actions), backordersService = inject(BackordersService)) => {
    return actions$.pipe(
      ofType(retryBackorder),
      switchMap(({ id, dto }) =>
        backordersService.retryBackorder(id, dto).pipe(
          map((backorder) => retryBackorderSuccess({ backorder })),
          catchError((error) => of(retryBackorderFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const cancelBackorder$ = createEffect(
  (actions$ = inject(Actions), backordersService = inject(BackordersService)) => {
    return actions$.pipe(
      ofType(cancelBackorder),
      switchMap(({ id, dto }) =>
        backordersService.cancelBackorder(id, dto).pipe(
          map((backorder) => cancelBackorderSuccess({ backorder })),
          catchError((error) => of(cancelBackorderFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
