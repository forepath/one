import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AvailabilityService } from '../../services/availability.service';

import {
  checkAvailability,
  checkAvailabilityAlternatives,
  checkAvailabilityAlternativesFailure,
  checkAvailabilityAlternativesSuccess,
  checkAvailabilityFailure,
  checkAvailabilitySuccess,
  previewPricing,
  previewPricingFailure,
  previewPricingSuccess,
} from './availability.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

export const checkAvailability$ = createEffect(
  (actions$ = inject(Actions), availabilityService = inject(AvailabilityService)) => {
    return actions$.pipe(
      ofType(checkAvailability),
      switchMap(({ check }) =>
        availabilityService.checkAvailability(check).pipe(
          map((response) => checkAvailabilitySuccess({ response })),
          catchError((error) => of(checkAvailabilityFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const checkAvailabilityAlternatives$ = createEffect(
  (actions$ = inject(Actions), availabilityService = inject(AvailabilityService)) => {
    return actions$.pipe(
      ofType(checkAvailabilityAlternatives),
      switchMap(({ check }) =>
        availabilityService.checkAvailabilityAlternatives(check).pipe(
          map((response) => checkAvailabilityAlternativesSuccess({ response })),
          catchError((error) => of(checkAvailabilityAlternativesFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const previewPricing$ = createEffect(
  (actions$ = inject(Actions), availabilityService = inject(AvailabilityService)) => {
    return actions$.pipe(
      ofType(previewPricing),
      switchMap(({ preview }) =>
        availabilityService.previewPricing(preview).pipe(
          map((response) => previewPricingSuccess({ response })),
          catchError((error) => of(previewPricingFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
