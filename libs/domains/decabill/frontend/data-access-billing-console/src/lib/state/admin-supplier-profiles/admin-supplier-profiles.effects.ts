import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, concatMap, from, map, of, switchMap, toArray } from 'rxjs';

import { billingPageWindow } from '../../constants/list-paging.constants';
import { AdminSupplierProfilesService } from '../../services/admin-supplier-profiles.service';
import type { AdminSupplierProfileDetail } from '../../types/suppliers.types';

import {
  createAdminSupplierProfile,
  createAdminSupplierProfileFailure,
  createAdminSupplierProfileSuccess,
  deleteAdminSupplierProfile,
  deleteAdminSupplierProfileFailure,
  deleteAdminSupplierProfileSuccess,
  loadAdminSupplierProfiles,
  loadAdminSupplierProfilesFailure,
  loadAdminSupplierProfilesSuccess,
  saveAdminSupplierProfileCustomData,
  saveAdminSupplierProfileCustomDataFailure,
  saveAdminSupplierProfileCustomDataSuccess,
  updateAdminSupplierProfile,
  updateAdminSupplierProfileFailure,
  updateAdminSupplierProfileSuccess,
} from './admin-supplier-profiles.actions';

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

export const loadAdminSupplierProfiles$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierProfilesService)) =>
    actions$.pipe(
      ofType(loadAdminSupplierProfiles),
      switchMap(({ search, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return service.list({ limit, offset, search }).pipe(
          map((response) => loadAdminSupplierProfilesSuccess({ profiles: response.items, total: response.total })),
          catchError((error) => of(loadAdminSupplierProfilesFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const createAdminSupplierProfile$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierProfilesService)) =>
    actions$.pipe(
      ofType(createAdminSupplierProfile),
      switchMap(({ dto }) =>
        service.create(dto).pipe(
          map((profile) => createAdminSupplierProfileSuccess({ profile })),
          catchError((error) => of(createAdminSupplierProfileFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateAdminSupplierProfile$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierProfilesService)) =>
    actions$.pipe(
      ofType(updateAdminSupplierProfile),
      switchMap(({ id, dto }) =>
        service.update(id, dto).pipe(
          map((profile) => updateAdminSupplierProfileSuccess({ profile })),
          catchError((error) => of(updateAdminSupplierProfileFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteAdminSupplierProfile$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierProfilesService)) =>
    actions$.pipe(
      ofType(deleteAdminSupplierProfile),
      switchMap(({ id }) =>
        service.delete(id).pipe(
          map(() => deleteAdminSupplierProfileSuccess({ id })),
          catchError((error) => of(deleteAdminSupplierProfileFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const saveAdminSupplierProfileCustomData$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierProfilesService)) =>
    actions$.pipe(
      ofType(saveAdminSupplierProfileCustomData),
      switchMap(({ id, original, next }) => {
        const mutations = buildCustomDataMutations(original, next);

        if (mutations.length === 0) {
          return service.getById(id).pipe(
            map((detail) => saveAdminSupplierProfileCustomDataSuccess({ detail })),
            catchError((error) => of(saveAdminSupplierProfileCustomDataFailure({ error: normalizeError(error) }))),
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
          map((results: AdminSupplierProfileDetail[]) => {
            const detail = results[results.length - 1];

            return saveAdminSupplierProfileCustomDataSuccess({ detail });
          }),
          catchError((error) => of(saveAdminSupplierProfileCustomDataFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);
