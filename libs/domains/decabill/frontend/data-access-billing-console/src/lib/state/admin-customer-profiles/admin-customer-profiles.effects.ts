import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AdminCustomerProfilesService } from '../../services/admin-customer-profiles.service';

import {
  createAdminCustomerProfile,
  createAdminCustomerProfileFailure,
  createAdminCustomerProfileSuccess,
  deleteAdminCustomerProfile,
  deleteAdminCustomerProfileFailure,
  deleteAdminCustomerProfileSuccess,
  loadAdminCustomerProfiles,
  loadAdminCustomerProfilesBatch,
  loadAdminCustomerProfileTrustScore,
  loadAdminCustomerProfileTrustScoreFailure,
  loadAdminCustomerProfileTrustScoreSuccess,
  loadAdminCustomerProfilesFailure,
  loadAdminCustomerProfilesSuccess,
  recomputeAdminCustomerProfileTrustScore,
  recomputeAdminCustomerProfileTrustScoreFailure,
  recomputeAdminCustomerProfileTrustScoreSuccess,
  updateAdminCustomerProfile,
  updateAdminCustomerProfileFailure,
  updateAdminCustomerProfileSuccess,
} from './admin-customer-profiles.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

const BATCH_SIZE = 10;

export const loadAdminCustomerProfiles$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminCustomerProfilesService)) =>
    actions$.pipe(
      ofType(loadAdminCustomerProfiles),
      switchMap(() =>
        service.list({ limit: BATCH_SIZE, offset: 0 }).pipe(
          switchMap((response) => {
            if (response.items.length === 0) {
              return of(loadAdminCustomerProfilesSuccess({ profiles: [] }));
            }

            if (response.items.length < BATCH_SIZE) {
              return of(loadAdminCustomerProfilesSuccess({ profiles: response.items }));
            }

            return of(loadAdminCustomerProfilesBatch({ offset: BATCH_SIZE, accumulatedProfiles: response.items }));
          }),
          catchError((error) => of(loadAdminCustomerProfilesFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminCustomerProfilesBatch$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminCustomerProfilesService)) =>
    actions$.pipe(
      ofType(loadAdminCustomerProfilesBatch),
      switchMap(({ offset, accumulatedProfiles }) =>
        service.list({ limit: BATCH_SIZE, offset }).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulatedProfiles, ...response.items];

            if (response.items.length === 0 || response.items.length < BATCH_SIZE) {
              return of(loadAdminCustomerProfilesSuccess({ profiles: newAccumulated }));
            }

            return of(
              loadAdminCustomerProfilesBatch({
                offset: offset + BATCH_SIZE,
                accumulatedProfiles: newAccumulated,
              }),
            );
          }),
          catchError((error) => of(loadAdminCustomerProfilesFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createAdminCustomerProfile$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminCustomerProfilesService)) =>
    actions$.pipe(
      ofType(createAdminCustomerProfile),
      switchMap(({ dto }) =>
        service.create(dto).pipe(
          map((profile) => createAdminCustomerProfileSuccess({ profile })),
          catchError((error) => of(createAdminCustomerProfileFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateAdminCustomerProfile$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminCustomerProfilesService)) =>
    actions$.pipe(
      ofType(updateAdminCustomerProfile),
      switchMap(({ id, dto }) =>
        service.update(id, dto).pipe(
          map((profile) => updateAdminCustomerProfileSuccess({ profile })),
          catchError((error) => of(updateAdminCustomerProfileFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteAdminCustomerProfile$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminCustomerProfilesService)) =>
    actions$.pipe(
      ofType(deleteAdminCustomerProfile),
      switchMap(({ id }) =>
        service.delete(id).pipe(
          map(() => deleteAdminCustomerProfileSuccess({ id })),
          catchError((error) => of(deleteAdminCustomerProfileFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminCustomerProfileTrustScore$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminCustomerProfilesService)) =>
    actions$.pipe(
      ofType(loadAdminCustomerProfileTrustScore),
      switchMap(({ id }) =>
        service.getTrustScore(id).pipe(
          map((detail) => loadAdminCustomerProfileTrustScoreSuccess({ detail })),
          catchError((error) => of(loadAdminCustomerProfileTrustScoreFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const recomputeAdminCustomerProfileTrustScore$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminCustomerProfilesService)) =>
    actions$.pipe(
      ofType(recomputeAdminCustomerProfileTrustScore),
      switchMap(({ id }) =>
        service.recomputeTrustScore(id).pipe(
          map((detail) => recomputeAdminCustomerProfileTrustScoreSuccess({ detail })),
          catchError((error) => of(recomputeAdminCustomerProfileTrustScoreFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
