import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { SERVICE_PLANS_BATCH_SIZE } from '../../constants/service-plans.constants';
import { PublicServicePlanOfferingsService } from '../../services/public-service-plan-offerings.service';

import {
  loadCheapestServicePlanOffering,
  loadCheapestServicePlanOfferingFailure,
  loadCheapestServicePlanOfferingSuccess,
  loadServicePlans,
  loadServicePlansBatch,
  loadServicePlansFailure,
  loadServicePlansSuccess,
} from './service-plans.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }

  return 'An unexpected error occurred';
}

const BATCH_SIZE = SERVICE_PLANS_BATCH_SIZE;

export const loadServicePlans$ = createEffect(
  (actions$ = inject(Actions), offeringsService = inject(PublicServicePlanOfferingsService)) => {
    return actions$.pipe(
      ofType(loadServicePlans),
      switchMap(({ params }) => {
        const batchParams = { limit: BATCH_SIZE, offset: 0, ...params };

        return offeringsService.listOfferings(batchParams).pipe(
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
  (actions$ = inject(Actions), offeringsService = inject(PublicServicePlanOfferingsService)) => {
    return actions$.pipe(
      ofType(loadServicePlansBatch),
      switchMap(({ offset, accumulatedServicePlans }) => {
        const batchParams = { limit: BATCH_SIZE, offset };

        return offeringsService.listOfferings(batchParams).pipe(
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

export const loadCheapestServicePlanOffering$ = createEffect(
  (actions$ = inject(Actions), offeringsService = inject(PublicServicePlanOfferingsService)) => {
    return actions$.pipe(
      ofType(loadCheapestServicePlanOffering),
      switchMap(({ serviceTypeId }) =>
        offeringsService.getCheapestOffering(serviceTypeId).pipe(
          map((offering) => loadCheapestServicePlanOfferingSuccess({ offering })),
          catchError((error) => of(loadCheapestServicePlanOfferingFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
