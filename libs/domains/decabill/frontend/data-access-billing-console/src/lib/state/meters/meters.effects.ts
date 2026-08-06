import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { MetersService } from '../../services/meters.service';

import {
  createMeter,
  createMeterFailure,
  createMeterSuccess,
  deleteMeter,
  deleteMeterFailure,
  deleteMeterSuccess,
  loadMeter,
  loadMeterFailure,
  loadMeters,
  loadMetersBatch,
  loadMetersFailure,
  loadMetersSuccess,
  loadMeterSuccess,
  updateMeter,
  updateMeterFailure,
  updateMeterSuccess,
} from './meters.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

const BATCH_SIZE = 10;

export const loadMeters$ = createEffect(
  (actions$ = inject(Actions), metersService = inject(MetersService)) =>
    actions$.pipe(
      ofType(loadMeters),
      switchMap(({ params }) => {
        const batchParams = { limit: BATCH_SIZE, offset: 0, ...params };

        return metersService.listMeters(batchParams).pipe(
          switchMap((meters) =>
            meters.length < BATCH_SIZE
              ? of(loadMetersSuccess({ meters }))
              : of(loadMetersBatch({ offset: BATCH_SIZE, accumulatedMeters: meters })),
          ),
          catchError((error) => of(loadMetersFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const loadMetersBatch$ = createEffect(
  (actions$ = inject(Actions), metersService = inject(MetersService)) =>
    actions$.pipe(
      ofType(loadMetersBatch),
      switchMap(({ offset, accumulatedMeters }) =>
        metersService.listMeters({ limit: BATCH_SIZE, offset }).pipe(
          switchMap((meters) => {
            const next = [...accumulatedMeters, ...meters];

            return meters.length < BATCH_SIZE
              ? of(loadMetersSuccess({ meters: next }))
              : of(loadMetersBatch({ offset: offset + BATCH_SIZE, accumulatedMeters: next }));
          }),
          catchError((error) => of(loadMetersFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadMeter$ = createEffect(
  (actions$ = inject(Actions), metersService = inject(MetersService)) =>
    actions$.pipe(
      ofType(loadMeter),
      switchMap(({ id }) =>
        metersService.getMeter(id).pipe(
          map((meter) => loadMeterSuccess({ meter })),
          catchError((error) => of(loadMeterFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createMeter$ = createEffect(
  (actions$ = inject(Actions), metersService = inject(MetersService)) =>
    actions$.pipe(
      ofType(createMeter),
      switchMap(({ meter }) =>
        metersService.createMeter(meter).pipe(
          map((created) => createMeterSuccess({ meter: created })),
          catchError((error) => of(createMeterFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateMeter$ = createEffect(
  (actions$ = inject(Actions), metersService = inject(MetersService)) =>
    actions$.pipe(
      ofType(updateMeter),
      switchMap(({ id, meter }) =>
        metersService.updateMeter(id, meter).pipe(
          map((updated) => updateMeterSuccess({ meter: updated })),
          catchError((error) => of(updateMeterFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteMeter$ = createEffect(
  (actions$ = inject(Actions), metersService = inject(MetersService)) =>
    actions$.pipe(
      ofType(deleteMeter),
      switchMap(({ id }) =>
        metersService.deleteMeter(id).pipe(
          map(() => deleteMeterSuccess({ id })),
          catchError((error) => of(deleteMeterFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
