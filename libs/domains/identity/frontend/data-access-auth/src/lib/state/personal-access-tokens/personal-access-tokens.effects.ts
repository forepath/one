import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AuthService } from '../../services/auth.service';

import {
  createPersonalAccessToken,
  createPersonalAccessTokenFailure,
  createPersonalAccessTokenSuccess,
  loadPersonalAccessTokenScopes,
  loadPersonalAccessTokenScopesFailure,
  loadPersonalAccessTokenScopesSuccess,
  loadPersonalAccessTokens,
  loadPersonalAccessTokensFailure,
  loadPersonalAccessTokensSuccess,
  revokePersonalAccessToken,
  revokePersonalAccessTokenFailure,
  revokePersonalAccessTokenSuccess,
  updatePersonalAccessToken,
  updatePersonalAccessTokenFailure,
  updatePersonalAccessTokenSuccess,
} from './personal-access-tokens.actions';

function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.error?.message) {
    return error.error.message;
  }

  if (error instanceof HttpErrorResponse && error.error?.error) {
    return typeof error.error.error === 'string' ? error.error.error : String(error.error.error);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }

  return 'An unexpected error occurred';
}

export const loadPersonalAccessTokens$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(loadPersonalAccessTokens),
      switchMap(() =>
        authService.listPersonalAccessTokens().pipe(
          map((tokens) => loadPersonalAccessTokensSuccess({ tokens })),
          catchError((error) => of(loadPersonalAccessTokensFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadPersonalAccessTokenScopes$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(loadPersonalAccessTokenScopes),
      switchMap(() =>
        authService.listTokenScopes().pipe(
          map((scopes) => loadPersonalAccessTokenScopesSuccess({ scopes })),
          catchError((error) => of(loadPersonalAccessTokenScopesFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createPersonalAccessToken$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(createPersonalAccessToken),
      switchMap(({ dto }) =>
        authService.createPersonalAccessToken(dto).pipe(
          map((token) => createPersonalAccessTokenSuccess({ token })),
          catchError((error) => of(createPersonalAccessTokenFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updatePersonalAccessToken$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(updatePersonalAccessToken),
      switchMap(({ id, dto }) =>
        authService.updatePersonalAccessToken(id, dto).pipe(
          map((token) => updatePersonalAccessTokenSuccess({ token })),
          catchError((error) => of(updatePersonalAccessTokenFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const revokePersonalAccessToken$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(revokePersonalAccessToken),
      switchMap(({ id }) =>
        authService.revokePersonalAccessToken(id).pipe(
          map(() => revokePersonalAccessTokenSuccess({ id })),
          catchError((error) => of(revokePersonalAccessTokenFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
