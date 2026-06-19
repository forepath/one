import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { CustomerProfileService } from '../../services/customer-profile.service';

import {
  loadCustomerProfile,
  loadCustomerProfileFailure,
  loadCustomerProfileSuccess,
  updateCustomerProfile,
  updateCustomerProfileFailure,
  updateCustomerProfileSuccess,
} from './customer-profile.actions';

function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.error) {
    const body = error.error;

    if (typeof body === 'string') return body;

    if (body && typeof body === 'object' && 'message' in body) return String(body.message);
  }

  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);

  return 'An unexpected error occurred';
}

export const loadCustomerProfile$ = createEffect(
  (actions$ = inject(Actions), customerProfileService = inject(CustomerProfileService)) => {
    return actions$.pipe(
      ofType(loadCustomerProfile),
      switchMap(() =>
        customerProfileService.getCustomerProfile().pipe(
          map((profile) => loadCustomerProfileSuccess({ profile })),
          catchError((error) => of(loadCustomerProfileFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateCustomerProfile$ = createEffect(
  (actions$ = inject(Actions), customerProfileService = inject(CustomerProfileService)) => {
    return actions$.pipe(
      ofType(updateCustomerProfile),
      switchMap(({ profile }) =>
        customerProfileService.updateCustomerProfile(profile).pipe(
          map((updatedProfile) => updateCustomerProfileSuccess({ profile: updatedProfile })),
          catchError((error) => of(updateCustomerProfileFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
