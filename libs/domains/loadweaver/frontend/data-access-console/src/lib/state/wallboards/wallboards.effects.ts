import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, map, mergeMap, of, switchMap } from 'rxjs';

import { KioskRequestError, WallboardsService } from '../../services/wallboards.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  createWallboard,
  createWallboardFailure,
  createWallboardSuccess,
  loadKiosk,
  loadKioskFailure,
  loadKioskSuccess,
  loadWallboards,
  loadWallboardsFailure,
  loadWallboardsSuccess,
  revokeWallboard,
  revokeWallboardFailure,
  revokeWallboardSuccess,
} from './wallboards.actions';

export const loadWallboards$ = createEffect(
  (actions$ = inject(Actions), service = inject(WallboardsService)) =>
    actions$.pipe(
      ofType(loadWallboards),
      switchMap(() =>
        service.list().pipe(
          map((tokens) => loadWallboardsSuccess({ tokens })),
          catchError((error: unknown) =>
            of(loadWallboardsFailure({ error: apiErrorMessage(error, 'Failed to load wallboard tokens') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const createWallboard$ = createEffect(
  (actions$ = inject(Actions), service = inject(WallboardsService)) =>
    actions$.pipe(
      ofType(createWallboard),
      exhaustMap(({ request }) =>
        service.create(request).pipe(
          map((token) => createWallboardSuccess({ token })),
          catchError((error: unknown) =>
            of(createWallboardFailure({ error: apiErrorMessage(error, 'Failed to create the wallboard token') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const revokeWallboard$ = createEffect(
  (actions$ = inject(Actions), service = inject(WallboardsService)) =>
    actions$.pipe(
      ofType(revokeWallboard),
      mergeMap(({ id }) =>
        service.revoke(id).pipe(
          map(() => revokeWallboardSuccess({ id })),
          catchError((error: unknown) =>
            of(revokeWallboardFailure({ id, error: apiErrorMessage(error, 'Failed to revoke the wallboard token') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadKiosk$ = createEffect(
  (actions$ = inject(Actions), service = inject(WallboardsService)) =>
    actions$.pipe(
      ofType(loadKiosk),
      switchMap(({ token }) =>
        service.kiosk(token).pipe(
          map((view) => loadKioskSuccess({ view, at: new Date().toISOString() })),
          catchError((error: unknown) =>
            of(
              loadKioskFailure({
                error: apiErrorMessage(error, 'Failed to load the wallboard'),
                unauthorized: error instanceof KioskRequestError && (error.status === 401 || error.status === 403),
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);
