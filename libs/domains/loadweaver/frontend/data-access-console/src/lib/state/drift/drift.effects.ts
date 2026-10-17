import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, map, of, switchMap, tap } from 'rxjs';

import { DriftService } from '../../services/drift.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  loadDrift,
  loadDriftFailure,
  loadDriftSuccess,
  proposeDriftPlan,
  proposeDriftPlanFailure,
  proposeDriftPlanSuccess,
} from './drift.actions';

export const loadDrift$ = createEffect(
  (actions$ = inject(Actions), service = inject(DriftService)) =>
    actions$.pipe(
      ofType(loadDrift),
      switchMap(() =>
        service.report().pipe(
          map((report) => loadDriftSuccess({ report })),
          catchError((error: unknown) =>
            of(loadDriftFailure({ error: apiErrorMessage(error, 'Failed to load the drift report') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const proposeDriftPlan$ = createEffect(
  (actions$ = inject(Actions), service = inject(DriftService)) =>
    actions$.pipe(
      ofType(proposeDriftPlan),
      exhaustMap(({ proposal }) =>
        service.propose(proposal).pipe(
          map((plan) => proposeDriftPlanSuccess({ plan })),
          catchError((error: unknown) =>
            of(proposeDriftPlanFailure({ error: apiErrorMessage(error, 'Failed to propose the plan') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** The proposed plan is reviewed like any plan. */
export const openProposedDriftPlan$ = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(proposeDriftPlanSuccess),
      tap(({ plan }) => void router.navigate(['/plans', plan.id])),
    ),
  { functional: true, dispatch: false },
);
