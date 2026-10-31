import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { ConsoleUsageService } from '../../services/usage.service';
import { apiErrorMessage } from '../../utils/api-error';
import { loadUsage, loadUsageFailure, loadUsageSuccess } from './usage.actions';

export const loadUsage$ = createEffect(
  (actions$ = inject(Actions), service = inject(ConsoleUsageService)) =>
    actions$.pipe(
      ofType(loadUsage),
      switchMap(({ query }) =>
        service.report(query).pipe(
          map((report) => loadUsageSuccess({ query, report })),
          catchError((error: unknown) =>
            of(loadUsageFailure({ query, error: apiErrorMessage(error, 'Failed to load the usage') })),
          ),
        ),
      ),
    ),
  { functional: true },
);
