import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { PublicWithdrawalService } from '../../services/public-withdrawal.service';

import {
  confirmPublicWithdrawal,
  confirmPublicWithdrawalFailure,
  confirmPublicWithdrawalSuccess,
  loadPublicWithdrawalAddressee,
  loadPublicWithdrawalAddresseeFailure,
  loadPublicWithdrawalAddresseeSuccess,
  requestPublicWithdrawal,
  requestPublicWithdrawalFailure,
  requestPublicWithdrawalSuccess,
  verifyPublicWithdrawalCode,
  verifyPublicWithdrawalCodeFailure,
  verifyPublicWithdrawalCodeSuccess,
} from './public-withdrawal.actions';

function normalizeError(error: unknown): string {
  if (error && typeof error === 'object' && 'error' in error) {
    const nested = (error as { error?: { message?: string } }).error;

    if (nested?.message) {
      return nested.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

export const loadPublicWithdrawalAddressee$ = createEffect(
  (actions$ = inject(Actions), publicWithdrawalService = inject(PublicWithdrawalService)) => {
    return actions$.pipe(
      ofType(loadPublicWithdrawalAddressee),
      switchMap(() =>
        publicWithdrawalService.getAddressee().pipe(
          map((addressee) => loadPublicWithdrawalAddresseeSuccess({ addressee })),
          catchError((error) => of(loadPublicWithdrawalAddresseeFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const requestPublicWithdrawal$ = createEffect(
  (actions$ = inject(Actions), publicWithdrawalService = inject(PublicWithdrawalService)) => {
    return actions$.pipe(
      ofType(requestPublicWithdrawal),
      switchMap(({ dto }) =>
        publicWithdrawalService.requestWithdrawal(dto).pipe(
          map((response) => requestPublicWithdrawalSuccess({ response })),
          catchError((error) => of(requestPublicWithdrawalFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const verifyPublicWithdrawalCode$ = createEffect(
  (actions$ = inject(Actions), publicWithdrawalService = inject(PublicWithdrawalService)) => {
    return actions$.pipe(
      ofType(verifyPublicWithdrawalCode),
      switchMap(({ dto }) =>
        publicWithdrawalService.verifyCode(dto).pipe(
          map((response) => verifyPublicWithdrawalCodeSuccess({ message: response.message })),
          catchError((error) => of(verifyPublicWithdrawalCodeFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const confirmPublicWithdrawal$ = createEffect(
  (actions$ = inject(Actions), publicWithdrawalService = inject(PublicWithdrawalService)) => {
    return actions$.pipe(
      ofType(confirmPublicWithdrawal),
      switchMap(({ dto }) =>
        publicWithdrawalService.confirmWithdrawal(dto).pipe(
          map((response) => confirmPublicWithdrawalSuccess({ response })),
          catchError((error) => of(confirmPublicWithdrawalFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
