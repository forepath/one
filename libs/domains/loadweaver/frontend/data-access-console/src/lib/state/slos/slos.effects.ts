import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { SlosService } from '../../services/slos.service';
import { apiErrorMessage } from '../../utils/api-error';
import { loadSlos, loadSlosFailure, loadSlosSuccess } from './slos.actions';

export const loadSlos$ = createEffect(
  (actions$ = inject(Actions), service = inject(SlosService)) =>
    actions$.pipe(
      ofType(loadSlos),
      switchMap(({ project }) =>
        service.list(project ?? undefined).pipe(
          map((slos) => loadSlosSuccess({ slos })),
          catchError((error: unknown) => of(loadSlosFailure({ error: apiErrorMessage(error, 'Failed to load SLOs') }))),
        ),
      ),
    ),
  { functional: true },
);
