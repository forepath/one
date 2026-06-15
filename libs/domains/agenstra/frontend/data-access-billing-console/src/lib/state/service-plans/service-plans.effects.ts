import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { ServicePlansService } from '../../services/service-plans.service';

import {
  createServicePlan,
  createServicePlanFailure,
  createServicePlanSuccess,
  deleteServicePlan,
  deleteServicePlanFailure,
  deleteServicePlanSuccess,
  loadServicePlan,
  loadServicePlanFailure,
  loadServicePlans,
  loadServicePlansBatch,
  loadServicePlansFailure,
  loadServicePlansSuccess,
  loadServicePlanSuccess,
  updateServicePlan,
  updateServicePlanFailure,
  updateServicePlanSuccess,
} from './service-plans.actions';

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

export const loadServicePlans$ = createEffect(
  (actions$ = inject(Actions), servicePlansService = inject(ServicePlansService)) => {
    return actions$.pipe(
      ofType(loadServicePlans),
      switchMap(({ params }) => {
        const batchParams = { limit: BATCH_SIZE, offset: 0, ...params };

        return servicePlansService.listServicePlans(batchParams).pipe(
          switchMap((servicePlans) => {
            if (servicePlans.length === 0) {
              return of(loadServicePlansSuccess({ servicePlans: [] }));
            }

            if (servicePlans.length < BATCH_SIZE) {
              return of(loadServicePlansSuccess({ servicePlans }));
            }

            return of(loadServicePlansBatch({ offset: BATCH_SIZE, accumulatedServicePlans: servicePlans }));
          }),
          catchError((error) => of(loadServicePlansFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadServicePlansBatch$ = createEffect(
  (actions$ = inject(Actions), servicePlansService = inject(ServicePlansService)) => {
    return actions$.pipe(
      ofType(loadServicePlansBatch),
      switchMap(({ offset, accumulatedServicePlans }) => {
        const batchParams = { limit: BATCH_SIZE, offset };

        return servicePlansService.listServicePlans(batchParams).pipe(
          switchMap((servicePlans) => {
            const newAccumulated = [...accumulatedServicePlans, ...servicePlans];

            if (servicePlans.length === 0) {
              return of(loadServicePlansSuccess({ servicePlans: newAccumulated }));
            }

            if (servicePlans.length < BATCH_SIZE) {
              return of(loadServicePlansSuccess({ servicePlans: newAccumulated }));
            }

            return of(
              loadServicePlansBatch({
                offset: offset + BATCH_SIZE,
                accumulatedServicePlans: newAccumulated,
              }),
            );
          }),
          catchError((error) => of(loadServicePlansFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadServicePlan$ = createEffect(
  (actions$ = inject(Actions), servicePlansService = inject(ServicePlansService)) => {
    return actions$.pipe(
      ofType(loadServicePlan),
      switchMap(({ id }) =>
        servicePlansService.getServicePlan(id).pipe(
          map((servicePlan) => loadServicePlanSuccess({ servicePlan })),
          catchError((error) => of(loadServicePlanFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createServicePlan$ = createEffect(
  (actions$ = inject(Actions), servicePlansService = inject(ServicePlansService)) => {
    return actions$.pipe(
      ofType(createServicePlan),
      switchMap(({ servicePlan }) =>
        servicePlansService.createServicePlan(servicePlan).pipe(
          map((createdServicePlan) => createServicePlanSuccess({ servicePlan: createdServicePlan })),
          catchError((error) => of(createServicePlanFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateServicePlan$ = createEffect(
  (actions$ = inject(Actions), servicePlansService = inject(ServicePlansService)) => {
    return actions$.pipe(
      ofType(updateServicePlan),
      switchMap(({ id, servicePlan }) =>
        servicePlansService.updateServicePlan(id, servicePlan).pipe(
          map((updatedServicePlan) => updateServicePlanSuccess({ servicePlan: updatedServicePlan })),
          catchError((error) => of(updateServicePlanFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteServicePlan$ = createEffect(
  (actions$ = inject(Actions), servicePlansService = inject(ServicePlansService)) => {
    return actions$.pipe(
      ofType(deleteServicePlan),
      switchMap(({ id }) =>
        servicePlansService.deleteServicePlan(id).pipe(
          map(() => deleteServicePlanSuccess({ id })),
          catchError((error) => of(deleteServicePlanFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
