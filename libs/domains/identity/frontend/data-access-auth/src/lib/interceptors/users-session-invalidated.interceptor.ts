import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { IDENTITY_AUTH_ENVIRONMENT, USERS_JWT_STORAGE_KEY } from '@forepath/identity/frontend';
import { Store } from '@ngrx/store';
import { catchError, tap, throwError } from 'rxjs';

import {
  EMAIL_NOT_CONFIRMED_CODE,
  LOGIN_2FA_INVALID_CODE,
  LOGIN_2FA_REQUIRED_CODE,
} from '../constants/auth-error.constants';
import { logout } from '../state/authentication/authentication.actions';

/** localStorage key for api-key auth; mirrors auth interceptor / effects. */
const API_KEY_STORAGE_KEY = 'agent-controller-api-key';
/**
 * Public auth endpoints where 401 is a form challenge (wrong password, 2FA, etc.),
 * not an expired session. Also excludes logout to avoid re-entry while logout$ runs.
 */
const INTERACTIVE_AUTH_PATH_SUFFIXES = [
  '/auth/login',
  '/auth/register',
  '/auth/confirm-email',
  '/auth/request-password-reset',
  '/auth/reset-password',
  '/auth/logout',
] as const;
/**
 * Interactive 401 messages that must not force logout (e.g. wrong current password).
 * Session/auth-mode failures use other messages or the generic Nest "Unauthorized".
 */
const INTERACTIVE_AUTH_MESSAGES = new Set([
  'Invalid email or password',
  'Current password is incorrect',
  'This account uses external authentication (Keycloak).',
]);
const INTERACTIVE_AUTH_CODES = new Set([EMAIL_NOT_CONFIRMED_CODE, LOGIN_2FA_REQUIRED_CODE, LOGIN_2FA_INVALID_CODE]);
/** Prevents a burst of parallel 401s from dispatching logout repeatedly. */
let invalidAuthHandlingInProgress = false;

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

function getApiErrorCode(error: HttpErrorResponse): string {
  const code = error.error?.code;

  return typeof code === 'string' ? code : '';
}

function isInteractiveAuthPath(url: string): boolean {
  try {
    const pathname = new URL(url, 'http://localhost').pathname.replace(/\/+$/, '');

    return INTERACTIVE_AUTH_PATH_SUFFIXES.some((suffix) => pathname.endsWith(suffix));
  } catch {
    return INTERACTIVE_AUTH_PATH_SUFFIXES.some((suffix) => url.includes(suffix));
  }
}

function isInteractiveAuthFailure(error: HttpErrorResponse, requestUrl: string): boolean {
  if (isInteractiveAuthPath(requestUrl) || isInteractiveAuthPath(error.url ?? '')) {
    return true;
  }

  const code = getApiErrorCode(error);

  if (code && INTERACTIVE_AUTH_CODES.has(code)) {
    return true;
  }

  const text = getApiErrorMessage(error);

  return text !== '' && INTERACTIVE_AUTH_MESSAGES.has(text);
}

/**
 * Any API 401 means credentials are no longer accepted (expired session, auth-mode
 * switch, Keycloak default Unauthorized, invalid API key), except interactive form
 * challenges on public auth endpoints / known password-check messages.
 */
function isInvalidAuthError(error: HttpErrorResponse, requestUrl: string): boolean {
  if (error.status !== 401) {
    return false;
  }

  return !isInteractiveAuthFailure(error, requestUrl);
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
 * On invalid-auth 401 for users, keycloak, or api-key: clears stored credentials when
 * applicable, dispatches {@link logout}, and navigates to `/login` immediately for
 * users and api-key (Keycloak redirect stays on existing logout effects).
 */
export const usersSessionInvalidatedInterceptor: HttpInterceptorFn = (req, next) => {
  const authEnv = inject(IDENTITY_AUTH_ENVIRONMENT);
  const store = inject(Store, { optional: true });
  const router = inject(Router, { optional: true });
  const authType = authEnv.authentication.type;

  if (authType !== 'users' && authType !== 'keycloak' && authType !== 'api-key') {
    return next(req);
  }

  if (!requestMatchesAuthApi(req.url, authEnv.apiUrl, authEnv.additionalApiUrls)) {
    return next(req);
  }

  return next(req).pipe(
    tap(() => {
      invalidAuthHandlingInProgress = false;
    }),
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || !isInvalidAuthError(error, req.url)) {
        return throwError(() => error);
      }

      if (invalidAuthHandlingInProgress) {
        return throwError(() => error);
      }

      invalidAuthHandlingInProgress = true;

      if (authType === 'users') {
        localStorage.removeItem(USERS_JWT_STORAGE_KEY);
      }

      if (authType === 'api-key') {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
      }

      if (store) {
        store.dispatch(logout({}));
      }

      if ((authType === 'users' || authType === 'api-key') && router) {
        void router.navigate(['/login']);
      } else if (!store && router) {
        void router.navigate(['/login']);
      }

      return throwError(() => error);
    }),
  );
};

/** Resets in-flight guard between unit tests. */
export function resetUsersSessionInvalidationStateForTests(): void {
  invalidAuthHandlingInProgress = false;
}

export function getUsersSessionInvalidationInterceptor(): HttpInterceptorFn {
  return usersSessionInvalidatedInterceptor;
}
