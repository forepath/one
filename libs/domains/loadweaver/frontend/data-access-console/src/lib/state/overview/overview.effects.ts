import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { OverviewService } from '../../services/overview.service';
import { loadOverview, loadOverviewFailure, loadOverviewSuccess } from './overview.actions';

export const loadOverview$ = createEffect(
  (actions$ = inject(Actions), service = inject(OverviewService)) =>
    actions$.pipe(
      ofType(loadOverview),
      switchMap(({ project }) =>
        service.overview(project).pipe(
          map((overview) => loadOverviewSuccess({ overview })),
          catchError((error: Error) => of(loadOverviewFailure({ error: error.message ?? 'Failed to load overview' }))),
        ),
      ),
    ),
  { functional: true },
);
