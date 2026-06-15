import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { ServiceTypesService } from '../../services/service-types.service';

import {
  createServiceType,
  createServiceTypeFailure,
  createServiceTypeSuccess,
  deleteServiceType,
  deleteServiceTypeFailure,
  deleteServiceTypeSuccess,
  loadProviderDetails,
  loadProviderDetailsFailure,
  loadProviderDetailsSuccess,
  loadServiceType,
  loadServiceTypeFailure,
  loadServiceTypes,
  loadServiceTypesBatch,
  loadServiceTypesFailure,
  loadServiceTypesSuccess,
  loadServiceTypeSuccess,
  updateServiceType,
  updateServiceTypeFailure,
  updateServiceTypeSuccess,
} from './service-types.actions';

/**
 * Normalizes error messages from HTTP errors.
 */
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

export const loadProviderDetails$ = createEffect(
  (actions$ = inject(Actions), serviceTypesService = inject(ServiceTypesService)) => {
    return actions$.pipe(
      ofType(loadProviderDetails),
      switchMap(() =>
        serviceTypesService.getProviderDetails().pipe(
          map((providerDetails) => loadProviderDetailsSuccess({ providerDetails })),
          catchError((error) => of(loadProviderDetailsFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadServiceTypes$ = createEffect(
  (actions$ = inject(Actions), serviceTypesService = inject(ServiceTypesService)) => {
    return actions$.pipe(
      ofType(loadServiceTypes),
      switchMap(({ params }) => {
        const batchParams = { limit: BATCH_SIZE, offset: 0, ...params };

        return serviceTypesService.listServiceTypes(batchParams).pipe(
          switchMap((serviceTypes) => {
            if (serviceTypes.length === 0) {
              return of(loadServiceTypesSuccess({ serviceTypes: [] }));
            }

            if (serviceTypes.length < BATCH_SIZE) {
              return of(loadServiceTypesSuccess({ serviceTypes }));
            }

            return of(loadServiceTypesBatch({ offset: BATCH_SIZE, accumulatedServiceTypes: serviceTypes }));
          }),
          catchError((error) => of(loadServiceTypesFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadServiceTypesBatch$ = createEffect(
  (actions$ = inject(Actions), serviceTypesService = inject(ServiceTypesService)) => {
    return actions$.pipe(
      ofType(loadServiceTypesBatch),
      switchMap(({ offset, accumulatedServiceTypes }) => {
        const batchParams = { limit: BATCH_SIZE, offset };

        return serviceTypesService.listServiceTypes(batchParams).pipe(
          switchMap((serviceTypes) => {
            const newAccumulated = [...accumulatedServiceTypes, ...serviceTypes];

            if (serviceTypes.length === 0) {
              return of(loadServiceTypesSuccess({ serviceTypes: newAccumulated }));
            }

            if (serviceTypes.length < BATCH_SIZE) {
              return of(loadServiceTypesSuccess({ serviceTypes: newAccumulated }));
            }

            return of(
              loadServiceTypesBatch({
                offset: offset + BATCH_SIZE,
                accumulatedServiceTypes: newAccumulated,
              }),
            );
          }),
          catchError((error) => of(loadServiceTypesFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadServiceType$ = createEffect(
  (actions$ = inject(Actions), serviceTypesService = inject(ServiceTypesService)) => {
    return actions$.pipe(
      ofType(loadServiceType),
      switchMap(({ id }) =>
        serviceTypesService.getServiceType(id).pipe(
          map((serviceType) => loadServiceTypeSuccess({ serviceType })),
          catchError((error) => of(loadServiceTypeFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createServiceType$ = createEffect(
  (actions$ = inject(Actions), serviceTypesService = inject(ServiceTypesService)) => {
    return actions$.pipe(
      ofType(createServiceType),
      switchMap(({ serviceType }) =>
        serviceTypesService.createServiceType(serviceType).pipe(
          map((createdServiceType) => createServiceTypeSuccess({ serviceType: createdServiceType })),
          catchError((error) => of(createServiceTypeFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateServiceType$ = createEffect(
  (actions$ = inject(Actions), serviceTypesService = inject(ServiceTypesService)) => {
    return actions$.pipe(
      ofType(updateServiceType),
      switchMap(({ id, serviceType }) =>
        serviceTypesService.updateServiceType(id, serviceType).pipe(
          map((updatedServiceType) => updateServiceTypeSuccess({ serviceType: updatedServiceType })),
          catchError((error) => of(updateServiceTypeFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteServiceType$ = createEffect(
  (actions$ = inject(Actions), serviceTypesService = inject(ServiceTypesService)) => {
    return actions$.pipe(
      ofType(deleteServiceType),
      switchMap(({ id }) =>
        serviceTypesService.deleteServiceType(id).pipe(
          map(() => deleteServiceTypeSuccess({ id })),
          catchError((error) => of(deleteServiceTypeFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
