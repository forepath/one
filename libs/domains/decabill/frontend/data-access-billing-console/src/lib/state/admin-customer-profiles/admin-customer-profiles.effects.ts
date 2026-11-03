import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, concatMap, from, map, of, switchMap, toArray } from 'rxjs';

import { billingPageWindow } from '../../constants/list-paging.constants';
import { AdminCustomerProfilesService } from '../../services/admin-customer-profiles.service';
import type { AdminCustomerProfileDetail } from '../../types/billing.types';

import {
  createAdminCustomerProfile,
  createAdminCustomerProfileFailure,
  createAdminCustomerProfileSuccess,
  deleteAdminCustomerProfile,
  deleteAdminCustomerProfileFailure,
  deleteAdminCustomerProfileSuccess,
  loadAdminCustomerProfiles,
  loadAdminCustomerProfileTrustScore,
  loadAdminCustomerProfileTrustScoreFailure,
  loadAdminCustomerProfileTrustScoreSuccess,
  loadAdminCustomerProfilesFailure,
  loadAdminCustomerProfilesSuccess,
  recomputeAdminCustomerProfileTrustScore,
  recomputeAdminCustomerProfileTrustScoreFailure,
  recomputeAdminCustomerProfileTrustScoreSuccess,
  saveAdminCustomerProfileCustomData,
  saveAdminCustomerProfileCustomDataFailure,
  saveAdminCustomerProfileCustomDataSuccess,
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

type CustomDataMutation =
  | { type: 'add'; key: string; value: string }
  | { type: 'update'; key: string; value: string }
  | { type: 'delete'; key: string };

function buildCustomDataMutations(
  original: Record<string, string>,
  next: Record<string, string>,
): CustomDataMutation[] {
  const mutations: CustomDataMutation[] = [];
  const originalKeys = new Set(Object.keys(original));
  const nextKeys = new Set(Object.keys(next));

  for (const key of nextKeys) {
    if (!originalKeys.has(key)) {
      mutations.push({ type: 'add', key, value: next[key] });
    } else if (original[key] !== next[key]) {
      mutations.push({ type: 'update', key, value: next[key] });
    }
  }

  for (const key of originalKeys) {
    if (!nextKeys.has(key)) {
      mutations.push({ type: 'delete', key });
    }
  }

  return mutations;
}

export const loadAdminCustomerProfiles$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminCustomerProfilesService)) =>
    actions$.pipe(
      ofType(loadAdminCustomerProfiles),
      switchMap(({ search, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return service.list({ limit, offset, search }).pipe(
          map((response) => loadAdminCustomerProfilesSuccess({ profiles: response.items, total: response.total })),
          catchError((error) => of(loadAdminCustomerProfilesFailure({ error: normalizeError(error) }))),
        );
      }),
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

export const saveAdminCustomerProfileCustomData$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminCustomerProfilesService)) =>
    actions$.pipe(
      ofType(saveAdminCustomerProfileCustomData),
      switchMap(({ id, original, next }) => {
        const mutations = buildCustomDataMutations(original, next);

        if (mutations.length === 0) {
          return service.getById(id).pipe(
            map((detail) => saveAdminCustomerProfileCustomDataSuccess({ detail })),
            catchError((error) => of(saveAdminCustomerProfileCustomDataFailure({ error: normalizeError(error) }))),
          );
        }

        return from(mutations).pipe(
          concatMap((mutation) => {
            if (mutation.type === 'add') {
              return service.addCustomData(id, { key: mutation.key, value: mutation.value });
            }

            if (mutation.type === 'update') {
              return service.updateCustomData(id, mutation.key, { value: mutation.value });
            }

            return service.deleteCustomData(id, mutation.key);
          }),
          toArray(),
          map((results: AdminCustomerProfileDetail[]) => {
            const detail = results[results.length - 1];

            return saveAdminCustomerProfileCustomDataSuccess({ detail });
          }),
          catchError((error) => of(saveAdminCustomerProfileCustomDataFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);
