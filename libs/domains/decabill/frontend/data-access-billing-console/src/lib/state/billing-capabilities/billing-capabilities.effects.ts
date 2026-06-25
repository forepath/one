import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import {
  loadBillingCapabilities,
  loadBillingCapabilitiesFailure,
  loadBillingCapabilitiesSuccess,
} from './billing-capabilities.actions';

export const loadBillingCapabilities$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadBillingCapabilities),
      switchMap(() =>
        service.getCapabilities().pipe(
          map((capabilities) => loadBillingCapabilitiesSuccess({ capabilities })),
          catchError((error: Error) =>
            of(loadBillingCapabilitiesFailure({ error: error.message ?? 'Failed to load capabilities' })),
          ),
        ),
      ),
    ),
  { functional: true },
);
