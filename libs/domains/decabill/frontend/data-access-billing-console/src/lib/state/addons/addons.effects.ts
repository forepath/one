import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AddonsService } from '../../services/addons.service';

import {
  createAddon,
  createAddonFailure,
  createAddonSuccess,
  deleteAddon,
  deleteAddonFailure,
  deleteAddonSuccess,
  loadAddon,
  loadAddonFailure,
  loadAddons,
  loadAddonsBatch,
  loadAddonsFailure,
  loadAddonsSuccess,
  loadAddonSuccess,
  updateAddon,
  updateAddonFailure,
  updateAddonSuccess,
} from './addons.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

const BATCH_SIZE = 10;

export const loadAddons$ = createEffect(
  (actions$ = inject(Actions), addonsService = inject(AddonsService)) =>
    actions$.pipe(
      ofType(loadAddons),
      switchMap(({ params }) => {
        const batchParams = { limit: BATCH_SIZE, offset: 0, ...params };

        return addonsService.listAddons(batchParams).pipe(
          switchMap((addons) =>
            addons.length < BATCH_SIZE
              ? of(loadAddonsSuccess({ addons }))
              : of(loadAddonsBatch({ offset: BATCH_SIZE, accumulatedAddons: addons, params })),
          ),
          catchError((error) => of(loadAddonsFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const loadAddonsBatch$ = createEffect(
  (actions$ = inject(Actions), addonsService = inject(AddonsService)) =>
    actions$.pipe(
      ofType(loadAddonsBatch),
      switchMap(({ offset, accumulatedAddons, params }) =>
        addonsService.listAddons({ limit: BATCH_SIZE, offset, ...params }).pipe(
          switchMap((addons) => {
            const next = [...accumulatedAddons, ...addons];

            return addons.length < BATCH_SIZE
              ? of(loadAddonsSuccess({ addons: next }))
              : of(loadAddonsBatch({ offset: offset + BATCH_SIZE, accumulatedAddons: next, params }));
          }),
          catchError((error) => of(loadAddonsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAddon$ = createEffect(
  (actions$ = inject(Actions), addonsService = inject(AddonsService)) =>
    actions$.pipe(
      ofType(loadAddon),
      switchMap(({ id }) =>
        addonsService.getAddon(id).pipe(
          map((addon) => loadAddonSuccess({ addon })),
          catchError((error) => of(loadAddonFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createAddon$ = createEffect(
  (actions$ = inject(Actions), addonsService = inject(AddonsService)) =>
    actions$.pipe(
      ofType(createAddon),
      switchMap(({ addon }) =>
        addonsService.createAddon(addon).pipe(
          map((created) => createAddonSuccess({ addon: created })),
          catchError((error) => of(createAddonFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateAddon$ = createEffect(
  (actions$ = inject(Actions), addonsService = inject(AddonsService)) =>
    actions$.pipe(
      ofType(updateAddon),
      switchMap(({ id, addon }) =>
        addonsService.updateAddon(id, addon).pipe(
          map((updated) => updateAddonSuccess({ addon: updated })),
          catchError((error) => of(updateAddonFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteAddon$ = createEffect(
  (actions$ = inject(Actions), addonsService = inject(AddonsService)) =>
    actions$.pipe(
      ofType(deleteAddon),
      switchMap(({ id }) =>
        addonsService.deleteAddon(id).pipe(
          map(() => deleteAddonSuccess({ id })),
          catchError((error) => of(deleteAddonFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
