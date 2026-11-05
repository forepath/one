import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, mergeMap, of, switchMap } from 'rxjs';

import { AuthService } from '../../services/auth.service';

import {
  createIdentityApp,
  createIdentityAppFailure,
  createIdentityAppSuccess,
  deleteIdentityApp,
  deleteIdentityAppFailure,
  deleteIdentityAppSuccess,
  loadIdentityAppGrants,
  loadIdentityAppGrantsFailure,
  loadIdentityAppGrantsSuccess,
  loadIdentityApps,
  loadIdentityAppsFailure,
  loadIdentityAppsSuccess,
  loadOwnAppGrants,
  loadOwnAppGrantsFailure,
  loadOwnAppGrantsSuccess,
  revokeAllIdentityAppGrants,
  revokeAllIdentityAppGrantsFailure,
  revokeAllIdentityAppGrantsSuccess,
  revokeIdentityAppGrant,
  revokeIdentityAppGrantFailure,
  revokeIdentityAppGrantSuccess,
  revokeOwnAppGrant,
  revokeOwnAppGrantFailure,
  revokeOwnAppGrantSuccess,
  rotateIdentityAppSecret,
  rotateIdentityAppSecretFailure,
  rotateIdentityAppSecretSuccess,
  updateIdentityApp,
  updateIdentityAppFailure,
  updateIdentityAppSuccess,
} from './identity-apps.actions';

export function normalizeIdentityAppsError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.error?.message) {
    const message = error.error.message;

    return Array.isArray(message) ? message.join(', ') : String(message);
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

  return 'An unexpected error occurred';
}

export const loadIdentityApps$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) =>
    actions$.pipe(
      ofType(loadIdentityApps),
      switchMap(() =>
        authService.listApps().pipe(
          map((apps) => loadIdentityAppsSuccess({ apps })),
          catchError((error) => of(loadIdentityAppsFailure({ error: normalizeIdentityAppsError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createIdentityApp$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) =>
    actions$.pipe(
      ofType(createIdentityApp),
      switchMap(({ dto }) =>
        authService.createApp(dto).pipe(
          map((app) => createIdentityAppSuccess({ app })),
          catchError((error) => of(createIdentityAppFailure({ error: normalizeIdentityAppsError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateIdentityApp$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) =>
    actions$.pipe(
      ofType(updateIdentityApp),
      switchMap(({ id, dto }) =>
        authService.updateApp(id, dto).pipe(
          map((app) => updateIdentityAppSuccess({ app })),
          catchError((error) => of(updateIdentityAppFailure({ error: normalizeIdentityAppsError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const rotateIdentityAppSecret$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) =>
    actions$.pipe(
      ofType(rotateIdentityAppSecret),
      switchMap(({ id }) =>
        authService.rotateAppSecret(id).pipe(
          map((app) => rotateIdentityAppSecretSuccess({ app })),
          catchError((error) => of(rotateIdentityAppSecretFailure({ error: normalizeIdentityAppsError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteIdentityApp$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) =>
    actions$.pipe(
      ofType(deleteIdentityApp),
      mergeMap(({ id }) =>
        authService.deleteApp(id).pipe(
          map(() => deleteIdentityAppSuccess({ id })),
          catchError((error) => of(deleteIdentityAppFailure({ error: normalizeIdentityAppsError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadIdentityAppGrants$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) =>
    actions$.pipe(
      ofType(loadIdentityAppGrants),
      switchMap(({ appId }) =>
        authService.listAppGrants(appId).pipe(
          map((grants) => loadIdentityAppGrantsSuccess({ appId, grants })),
          catchError((error) => of(loadIdentityAppGrantsFailure({ error: normalizeIdentityAppsError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const revokeIdentityAppGrant$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) =>
    actions$.pipe(
      ofType(revokeIdentityAppGrant),
      mergeMap(({ appId, grantId }) =>
        authService.revokeAppGrant(appId, grantId).pipe(
          map(() => revokeIdentityAppGrantSuccess({ appId, grantId })),
          catchError((error) => of(revokeIdentityAppGrantFailure({ error: normalizeIdentityAppsError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const revokeAllIdentityAppGrants$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) =>
    actions$.pipe(
      ofType(revokeAllIdentityAppGrants),
      switchMap(({ appId }) =>
        authService.revokeAllAppGrants(appId).pipe(
          map(() => revokeAllIdentityAppGrantsSuccess({ appId })),
          catchError((error) => of(revokeAllIdentityAppGrantsFailure({ error: normalizeIdentityAppsError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadOwnAppGrants$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) =>
    actions$.pipe(
      ofType(loadOwnAppGrants),
      switchMap(() =>
        authService.listOwnAppGrants().pipe(
          map((grants) => loadOwnAppGrantsSuccess({ grants })),
          catchError((error) => of(loadOwnAppGrantsFailure({ error: normalizeIdentityAppsError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const revokeOwnAppGrant$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) =>
    actions$.pipe(
      ofType(revokeOwnAppGrant),
      mergeMap(({ grantId }) =>
        authService.revokeOwnAppGrant(grantId).pipe(
          map(() => revokeOwnAppGrantSuccess({ grantId })),
          catchError((error) => of(revokeOwnAppGrantFailure({ error: normalizeIdentityAppsError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
