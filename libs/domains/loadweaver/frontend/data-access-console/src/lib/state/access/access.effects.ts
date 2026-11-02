import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AccessService } from '../../services/access.service';
import { loadAccess, loadAccessFailure, loadAccessSuccess } from './access.actions';

export const loadAccess$ = createEffect(
  (actions$ = inject(Actions), service = inject(AccessService)) =>
    actions$.pipe(
      ofType(loadAccess),
      switchMap(() =>
        service.me().pipe(
          map((me) => loadAccessSuccess({ me })),
          catchError((error: Error) => of(loadAccessFailure({ error: error.message ?? 'Failed to load access' }))),
        ),
      ),
    ),
  { functional: true },
);
