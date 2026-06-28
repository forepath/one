import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { CloudInitConfigsService } from '../../services/cloud-init-configs.service';

import {
  createCloudInitConfig,
  createCloudInitConfigFailure,
  createCloudInitConfigSuccess,
  deleteCloudInitConfig,
  deleteCloudInitConfigFailure,
  deleteCloudInitConfigSuccess,
  loadCloudInitConfig,
  loadCloudInitConfigFailure,
  loadCloudInitConfigs,
  loadCloudInitConfigsBatch,
  loadCloudInitConfigsFailure,
  loadCloudInitConfigsSuccess,
  loadCloudInitConfigSuccess,
  updateCloudInitConfig,
  updateCloudInitConfigFailure,
  updateCloudInitConfigSuccess,
} from './cloud-init-configs.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }

  return 'An unexpected error occurred';
}

const BATCH_SIZE = 10;

export const loadCloudInitConfigs$ = createEffect(
  (actions$ = inject(Actions), cloudInitConfigsService = inject(CloudInitConfigsService)) => {
    return actions$.pipe(
      ofType(loadCloudInitConfigs),
      switchMap(({ params }) => {
        const batchParams = { limit: BATCH_SIZE, offset: 0, ...params };

        return cloudInitConfigsService.listCloudInitConfigs(batchParams).pipe(
          switchMap((cloudInitConfigs) => {
            if (cloudInitConfigs.length < BATCH_SIZE) {
              return of(loadCloudInitConfigsSuccess({ cloudInitConfigs }));
            }

            return of(loadCloudInitConfigsBatch({ offset: BATCH_SIZE, accumulatedCloudInitConfigs: cloudInitConfigs }));
          }),
          catchError((error) => of(loadCloudInitConfigsFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadCloudInitConfigsBatch$ = createEffect(
  (actions$ = inject(Actions), cloudInitConfigsService = inject(CloudInitConfigsService)) => {
    return actions$.pipe(
      ofType(loadCloudInitConfigsBatch),
      switchMap(({ offset, accumulatedCloudInitConfigs }) =>
        cloudInitConfigsService.listCloudInitConfigs({ limit: BATCH_SIZE, offset }).pipe(
          switchMap((cloudInitConfigs) => {
            const newAccumulated = [...accumulatedCloudInitConfigs, ...cloudInitConfigs];

            if (cloudInitConfigs.length < BATCH_SIZE) {
              return of(loadCloudInitConfigsSuccess({ cloudInitConfigs: newAccumulated }));
            }

            return of(
              loadCloudInitConfigsBatch({
                offset: offset + BATCH_SIZE,
                accumulatedCloudInitConfigs: newAccumulated,
              }),
            );
          }),
          catchError((error) => of(loadCloudInitConfigsFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadCloudInitConfig$ = createEffect(
  (actions$ = inject(Actions), cloudInitConfigsService = inject(CloudInitConfigsService)) => {
    return actions$.pipe(
      ofType(loadCloudInitConfig),
      switchMap(({ id }) =>
        cloudInitConfigsService.getCloudInitConfig(id).pipe(
          map((cloudInitConfig) => loadCloudInitConfigSuccess({ cloudInitConfig })),
          catchError((error) => of(loadCloudInitConfigFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createCloudInitConfig$ = createEffect(
  (actions$ = inject(Actions), cloudInitConfigsService = inject(CloudInitConfigsService)) => {
    return actions$.pipe(
      ofType(createCloudInitConfig),
      switchMap(({ cloudInitConfig }) =>
        cloudInitConfigsService.createCloudInitConfig(cloudInitConfig).pipe(
          map((created) => createCloudInitConfigSuccess({ cloudInitConfig: created })),
          catchError((error) => of(createCloudInitConfigFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateCloudInitConfig$ = createEffect(
  (actions$ = inject(Actions), cloudInitConfigsService = inject(CloudInitConfigsService)) => {
    return actions$.pipe(
      ofType(updateCloudInitConfig),
      switchMap(({ id, cloudInitConfig }) =>
        cloudInitConfigsService.updateCloudInitConfig(id, cloudInitConfig).pipe(
          map((updated) => updateCloudInitConfigSuccess({ cloudInitConfig: updated })),
          catchError((error) => of(updateCloudInitConfigFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteCloudInitConfig$ = createEffect(
  (actions$ = inject(Actions), cloudInitConfigsService = inject(CloudInitConfigsService)) => {
    return actions$.pipe(
      ofType(deleteCloudInitConfig),
      switchMap(({ id }) =>
        cloudInitConfigsService.deleteCloudInitConfig(id).pipe(
          map(() => deleteCloudInitConfigSuccess({ id })),
          catchError((error) => of(deleteCloudInitConfigFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
