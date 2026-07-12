import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { IDENTITY_AUTH_ENVIRONMENT, USERS_JWT_STORAGE_KEY } from '@forepath/identity/frontend';
import { Store } from '@ngrx/store';
import { catchError, throwError } from 'rxjs';

import { logout } from '../state/authentication/authentication.actions';

/**
 * Backend messages from UsersAuthGuard (and related) that mean the JWT session must end.
 * Intentionally excludes e.g. change-password "Current password is incorrect" (also 401).
 */
const SESSION_TERMINATION_MESSAGES = new Set([
  'This account is locked. Please contact an administrator.',
  'Session is no longer valid.',
  'Invalid or expired token',
  'Missing or invalid authorization token',
]);

function getApiErrorMessage(error: HttpErrorResponse): string {
  const message = error.error?.message;

  if (typeof message === 'string') {
    return message;
  }

  if (Array.isArray(message)) {
    return message.join(' ');
  }

  return '';
}

function isSessionTerminationError(error: HttpErrorResponse): boolean {
  if (error.status !== 401) {
    return false;
  }

  const text = getApiErrorMessage(error);

  if (!text) {
    return false;
  }

  return SESSION_TERMINATION_MESSAGES.has(text);
}

function requestMatchesAuthApi(
  url: string,
  apiUrl: string | undefined,
  additionalApiUrls: readonly string[] | undefined,
): boolean {
  const bases = [apiUrl, ...(additionalApiUrls ?? [])].filter((b): b is string => !!b);

  return bases.some((base) => url.startsWith(base));
}

/**
 * For users-mode JWT and Keycloak auth: on 401 with session-invalidating API messages,
 * clears the stored users JWT when applicable, dispatches {@link logout} (NgRx), and relies
 * on existing logout effects (including Keycloak logout) for redirect.
 */
export const usersSessionInvalidatedInterceptor: HttpInterceptorFn = (req, next) => {
  const authEnv = inject(IDENTITY_AUTH_ENVIRONMENT);
  const store = inject(Store, { optional: true });
  const router = inject(Router, { optional: true });

  if (authEnv.authentication.type !== 'users' && authEnv.authentication.type !== 'keycloak') {
    return next(req);
  }

  if (!requestMatchesAuthApi(req.url, authEnv.apiUrl, authEnv.additionalApiUrls)) {
    return next(req);
  }

  return next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || !isSessionTerminationError(error)) {
        return throwError(() => error);
      }

      if (authEnv.authentication.type === 'users') {
        localStorage.removeItem(USERS_JWT_STORAGE_KEY);
      }

      if (store) {
        store.dispatch(logout({}));
      } else if (router) {
        void router.navigate(['/login']);
      }

      return throwError(() => error);
    }),
  );
};

export function getUsersSessionInvalidationInterceptor(): HttpInterceptorFn {
  return usersSessionInvalidatedInterceptor;
}
