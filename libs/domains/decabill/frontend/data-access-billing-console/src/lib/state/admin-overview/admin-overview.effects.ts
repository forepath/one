import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import { loadAdminOverview, loadAdminOverviewFailure, loadAdminOverviewSuccess } from './admin-overview.actions';

function overviewErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = (error.error as { message?: unknown } | null)?.message;

    if (typeof message === 'string' && message.trim()) return message;
  }

  return (error as Error | null)?.message || 'Failed to load overview';
}

/** Latest request wins (`switchMap`): switching tenant or range cancels an in-flight load. */
export const loadAdminOverview$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminOverview),
      switchMap(({ params }) =>
        service.getOverview(params).pipe(
          map((overview) => loadAdminOverviewSuccess({ overview })),
          catchError((error: unknown) => of(loadAdminOverviewFailure({ error: overviewErrorMessage(error) }))),
        ),
      ),
    ),
  { functional: true },
);
