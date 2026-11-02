import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { BILLING_LIST_PAGE_SIZE } from '../../constants/list-paging.constants';
import { BackordersService } from '../../services/backorders.service';

import {
  cancelBackorder,
  cancelBackorderFailure,
  cancelBackorderSuccess,
  loadBackorders,
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

/**
 * One page of backorders (replace-page). The API returns an array without a total, so one extra row is requested to
 * tell whether a next page exists.
 */
export const loadBackorders$ = createEffect(
  (actions$ = inject(Actions), backordersService = inject(BackordersService)) => {
    return actions$.pipe(
      ofType(loadBackorders),
      switchMap(({ params }) => {
        const limit = params?.limit && params.limit > 0 ? params.limit : BILLING_LIST_PAGE_SIZE;
        const pageParams = { ...params, limit: limit + 1, offset: params?.offset ?? 0 };

        return backordersService.listBackorders(pageParams).pipe(
          map((backorders) =>
            loadBackordersSuccess({ backorders: backorders.slice(0, limit), hasMore: backorders.length > limit }),
          ),
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
