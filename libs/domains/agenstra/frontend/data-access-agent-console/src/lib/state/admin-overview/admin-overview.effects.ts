import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { StatisticsService } from '../../services/statistics.service';

import { loadAdminOverview, loadAdminOverviewFailure, loadAdminOverviewSuccess } from './admin-overview.actions';

/** The API's message (e.g. "Invalid date range …") when present, else the transport error. */
function overviewErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = (error.error as { message?: unknown } | null)?.message;

    if (typeof message === 'string' && message.trim()) return message;
  }

  return (error as Error | null)?.message || 'Failed to load overview';
}

/** Latest request wins (`switchMap`): switching workspace or range cancels an in-flight load. */
export const loadAdminOverview$ = createEffect(
  (actions$ = inject(Actions), service = inject(StatisticsService)) =>
    actions$.pipe(
      ofType(loadAdminOverview),
      switchMap(({ params }) =>
        service.getAdminOverview(params).pipe(
          map((overview) => loadAdminOverviewSuccess({ overview })),
          catchError((error: unknown) => of(loadAdminOverviewFailure({ error: overviewErrorMessage(error) }))),
        ),
      ),
    ),
  { functional: true },
);
