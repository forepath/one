import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import { IDENTITY_AUTH_ENVIRONMENT, jwtPayloadHasPatAmr, parseJwtPayload } from '@forepath/identity/frontend';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { KeycloakService } from 'keycloak-angular';
import { catchError, filter, from, map, of, switchMap, tap } from 'rxjs';

import {
  EMAIL_NOT_CONFIRMED_CODE,
  LOGIN_2FA_REQUIRED_CODE,
  PENDING_LOGIN_PASSWORD_STORAGE_KEY,
} from '../../constants/auth-error.constants';
import { AuthService, LOGIN_SUCCESS_REDIRECT_TARGET } from '../../services/auth.service';

import {
  adminClearTotp,
  adminClearTotpFailure,
  adminClearTotpSuccess,
  changePassword,
  changePasswordFailure,
  changePasswordSuccess,
  checkAuthentication,
  checkAuthenticationFailure,
  checkAuthenticationSuccess,
  confirmEmail,
  confirmEmailFailure,
  confirmEmailSuccess,
  confirmTotp,
  confirmTotpFailure,
  confirmTotpSuccess,
  createUser,
  createUserFailure,
  createUserSuccess,
  deleteUser,
  deleteUserFailure,
  deleteUserSuccess,
  disableEmail2fa,
  disableEmail2faFailure,
  disableEmail2faSuccess,
  disableTotp,
  disableTotpFailure,
  disableTotpSuccess,
  enableEmail2fa,
  enableEmail2faFailure,
  enableEmail2faSuccess,
  lockUser,
  lockUserFailure,
  lockUserSuccess,
  loadTwoFactorStatus,
  loadTwoFactorStatusFailure,
  loadTwoFactorStatusSuccess,
  loadUsers,
  loadUsersBatch,
  loadUsersFailure,
  loadUsersSuccess,
  login,
  loginFailure,
  loginSuccess,
  logout,
  logoutFailure,
  logoutSuccess,
  register,
  registerFailure,
  registerSuccess,
  requestPasswordReset,
  requestPasswordResetFailure,
  requestPasswordResetSuccess,
  resetPassword,
  resetPasswordFailure,
  resetPasswordSuccess,
  setupTotp,
  setupTotpFailure,
  setupTotpSuccess,
  unlockUser,
  unlockUserFailure,
  unlockUserSuccess,
  updateUser,
  updateUserFailure,
  updateUserSuccess,
} from './authentication.actions';
import type { Login2faMethod } from './authentication.types';

const API_KEY_STORAGE_KEY = 'agent-controller-api-key';
const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';

/** Keycloak token structure with realm_access and resource_access. */
interface KeycloakTokenPayload {
  realm_access?: { roles?: unknown };
  resource_access?: Record<string, { roles?: unknown }>;
  [key: string]: unknown;
}

/**
 * Extracts roles from Keycloak token payload.
 * Mirrors backend KeycloakRolesGuard logic: realm_access.roles and resource_access.<client>.roles.
 */
function getRolesFromKeycloakToken(token: unknown): string[] {
  if (!token || typeof token !== 'object') {
    return [];
  }

  const obj = token as Record<string, unknown>;

  if (Array.isArray(obj['roles'])) {
    return obj['roles'].filter((r): r is string => typeof r === 'string');
  }

  const tokenPayload = obj as KeycloakTokenPayload;
  const roles: string[] = [];
  const seen = new Set<string>();

  function collectRoles(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && !seen.has(item)) {
          seen.add(item);
          roles.push(item);
        } else if (item !== null && typeof item === 'object') {
          collectRoles(item);
        }
      }
    } else if (value !== null && typeof value === 'object') {
      for (const v of Object.values(value)) {
        collectRoles(v);
      }
    }
  }

  collectRoles(tokenPayload.realm_access?.roles);

  if (tokenPayload.resource_access && typeof tokenPayload.resource_access === 'object') {
    for (const resource of Object.values(tokenPayload.resource_access)) {
      if (resource !== null && typeof resource === 'object' && 'roles' in resource) {
        collectRoles((resource as { roles?: unknown }).roles);
      }
    }
  }

  return roles;
}

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

  return 'An unexpected authentication error occurred';
}

function isEmailNotConfirmedError(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || !error.error || typeof error.error !== 'object') {
    return false;
  }

  return (error.error as { code?: unknown }).code === EMAIL_NOT_CONFIRMED_CODE;
}

function getLogin2faMethod(error: unknown): Login2faMethod | null {
  if (!(error instanceof HttpErrorResponse) || !error.error || typeof error.error !== 'object') {
    return null;
  }

  const body = error.error as { code?: unknown; method?: unknown };

  if (body.code !== LOGIN_2FA_REQUIRED_CODE) {
    return null;
  }

  if (body.method === 'email' || body.method === 'totp') {
    return body.method;
  }

  return null;
}

export const login$ = createEffect(
  (
    actions$ = inject(Actions),
    authEnvironment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT),
    keycloakService = inject(KeycloakService, { optional: true }),
    authService = inject(AuthService, { optional: true }),
  ) => {
    return actions$.pipe(
      ofType(login),
      switchMap(({ apiKey, email, password, code }) => {
        if (authEnvironment.authentication.type === 'api-key') {
          const keyToStore = apiKey || authEnvironment.authentication.apiKey;

          if (keyToStore) {
            localStorage.setItem(API_KEY_STORAGE_KEY, keyToStore);

            return of(loginSuccess({ authenticationType: 'api-key' }));
          }

          return of(loginFailure({ error: 'API key is required for authentication' }));
        }

        if (authEnvironment.authentication.type === 'keycloak' && keycloakService) {
          return from(keycloakService.login()).pipe(
            map(() => loginSuccess({ authenticationType: 'keycloak' })),
            catchError((error) => of(loginFailure({ error: normalizeError(error) }))),
          );
        }

        if (authEnvironment.authentication.type === 'users' && authService && email && password) {
          return authService.login(email, password, code).pipe(
            map((res) => {
              sessionStorage.removeItem(PENDING_LOGIN_PASSWORD_STORAGE_KEY);
              localStorage.setItem(USERS_JWT_STORAGE_KEY, res.access_token);

              return loginSuccess({
                authenticationType: 'users',
                user: res.user,
              });
            }),
            catchError((error) => {
              const method = getLogin2faMethod(error);

              if (method) {
                sessionStorage.setItem(PENDING_LOGIN_PASSWORD_STORAGE_KEY, password);

                return of(
                  loginFailure({
                    error: normalizeError(error),
                    login2fa: { email, password, method },
                  }),
                );
              }

              return of(
                loginFailure({
                  error: normalizeError(error),
                  confirmEmail: isEmailNotConfirmedError(error) ? email : undefined,
                }),
              );
            }),
          );
        }

        return of(loginFailure({ error: 'Authentication service not available' }));
      }),
    );
  },
  { functional: true },
);

export const loginSuccessRedirect$ = createEffect(
  (actions$ = inject(Actions), router = inject(Router), redirectTarget = inject(LOGIN_SUCCESS_REDIRECT_TARGET)) => {
    return actions$.pipe(
      ofType(loginSuccess),
      tap(() => {
        router.navigate(redirectTarget);
      }),
    );
  },
  { functional: true, dispatch: false },
);

export const loginEmailNotConfirmedRedirect$ = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) => {
    return actions$.pipe(
      ofType(loginFailure),
      tap(({ confirmEmail }) => {
        if (!confirmEmail) {
          return;
        }

        router.navigate(['/confirm-email'], {
          queryParams: { email: confirmEmail },
        });
      }),
    );
  },
  { functional: true, dispatch: false },
);

export const loginTwoFactorRequiredRedirect$ = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) => {
    return actions$.pipe(
      ofType(loginFailure),
      tap(({ login2fa }) => {
        if (!login2fa) {
          return;
        }

        router.navigate(['/login-2fa'], {
          queryParams: { email: login2fa.email, method: login2fa.method },
        });
      }),
    );
  },
  { functional: true, dispatch: false },
);

export const logout$ = createEffect(
  (
    actions$ = inject(Actions),
    authEnvironment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT),
    keycloakService = inject(KeycloakService, { optional: true }),
    authService = inject(AuthService, { optional: true }),
  ) => {
    return actions$.pipe(
      ofType(logout),
      switchMap(({ invalidateAllSessions }) => {
        if (authEnvironment.authentication.type === 'api-key') {
          localStorage.removeItem(API_KEY_STORAGE_KEY);

          return of(logoutSuccess());
        }

        if (authEnvironment.authentication.type === 'keycloak' && keycloakService) {
          return from(keycloakService.logout()).pipe(
            map(() => logoutSuccess()),
            catchError((error) => of(logoutFailure({ error: normalizeError(error) }))),
          );
        }

        if (authEnvironment.authentication.type === 'users' && authService) {
          return authService.logout(invalidateAllSessions === true).pipe(
            map(() => {
              localStorage.removeItem(USERS_JWT_STORAGE_KEY);

              return logoutSuccess();
            }),
            catchError(() => {
              localStorage.removeItem(USERS_JWT_STORAGE_KEY);

              return of(logoutSuccess());
            }),
          );
        }

        if (authEnvironment.authentication.type === 'users') {
          localStorage.removeItem(USERS_JWT_STORAGE_KEY);

          return of(logoutSuccess());
        }

        return of(logoutSuccess());
      }),
    );
  },
  { functional: true },
);

export const logoutSuccessRedirect$ = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) => {
    return actions$.pipe(
      ofType(logoutSuccess),
      tap(() => {
        router.navigate(['/login']);
      }),
    );
  },
  { functional: true, dispatch: false },
);

export const checkAuthentication$ = createEffect(
  (
    actions$ = inject(Actions),
    authEnvironment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT),
    keycloakService = inject(KeycloakService, { optional: true }),
  ) => {
    return actions$.pipe(
      ofType(checkAuthentication),
      switchMap(() => {
        if (authEnvironment.authentication.type === 'api-key') {
          const envApiKey = authEnvironment.authentication.apiKey;
          const storedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
          const isAuthenticated = !!(envApiKey || storedApiKey);

          return of(
            checkAuthenticationSuccess({
              isAuthenticated,
              authenticationType: isAuthenticated ? 'api-key' : undefined,
            }),
          );
        }

        if (authEnvironment.authentication.type === 'keycloak' && keycloakService) {
          try {
            const isAuthenticated = keycloakService.isLoggedIn();
            const instance = keycloakService.getKeycloakInstance();
            const roles = getRolesFromKeycloakToken(instance?.tokenParsed);
            const role = roles.includes('admin') ? 'admin' : 'user';

            return of(
              checkAuthenticationSuccess({
                isAuthenticated,
                authenticationType: isAuthenticated ? 'keycloak' : undefined,
                user: instance?.tokenParsed
                  ? {
                      id: instance.tokenParsed['sub'] ?? '',
                      email: instance.tokenParsed['email'] ?? '',
                      role: role,
                    }
                  : undefined,
              }),
            );
          } catch (error) {
            return of(checkAuthenticationFailure({ error: normalizeError(error) }));
          }
        }

        if (authEnvironment.authentication.type === 'users') {
          const jwt = localStorage.getItem(USERS_JWT_STORAGE_KEY);

          if (jwt) {
            try {
              const payload = parseJwtPayload(jwt);

              if (!payload || jwtPayloadHasPatAmr(payload)) {
                localStorage.removeItem(USERS_JWT_STORAGE_KEY);

                return of(checkAuthenticationSuccess({ isAuthenticated: false }));
              }

              const exp = typeof payload['exp'] === 'number' ? payload['exp'] * 1000 : 0;
              const isAuthenticated = exp > Date.now();
              const roles = Array.isArray(payload['roles'])
                ? payload['roles'].filter((role): role is string => typeof role === 'string')
                : [];
              const role = roles.includes('admin') ? 'admin' : 'user';
              const user =
                typeof payload['sub'] === 'string' && typeof payload['email'] === 'string'
                  ? { id: payload['sub'], email: payload['email'], role }
                  : undefined;

              if (!isAuthenticated) {
                localStorage.removeItem(USERS_JWT_STORAGE_KEY);
              }

              return of(
                checkAuthenticationSuccess({
                  isAuthenticated,
                  authenticationType: isAuthenticated ? 'users' : undefined,
                  user: isAuthenticated ? user : undefined,
                }),
              );
            } catch {
              localStorage.removeItem(USERS_JWT_STORAGE_KEY);

              return of(checkAuthenticationSuccess({ isAuthenticated: false }));
            }
          }

          return of(checkAuthenticationSuccess({ isAuthenticated: false }));
        }

        return of(checkAuthenticationSuccess({ isAuthenticated: false }));
      }),
    );
  },
  { functional: true },
);

// --- Users auth effects ---

export const register$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(register),
      switchMap(({ email, password }) =>
        authService.register(email, password).pipe(
          map((res) =>
            registerSuccess({
              user: res.user,
              message: res.message,
              emailConfirmed: res.emailConfirmed,
            }),
          ),
          catchError((error) => of(registerFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const registerSuccessRedirect$ = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) => {
    return actions$.pipe(
      ofType(registerSuccess),
      tap(({ user, emailConfirmed }) => {
        if (emailConfirmed) {
          router.navigate(['/login']);

          return;
        }

        router.navigate(['/confirm-email'], {
          queryParams: { email: user.email },
        });
      }),
    );
  },
  { functional: true, dispatch: false },
);

export const confirmEmail$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(confirmEmail),
      switchMap(({ email, code }) =>
        authService.confirmEmail(email, code).pipe(
          map(() => confirmEmailSuccess()),
          catchError((error) => of(confirmEmailFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const confirmEmailSuccessRedirect$ = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) => {
    return actions$.pipe(
      ofType(confirmEmailSuccess),
      tap(() => {
        router.navigate(['/login']);
      }),
    );
  },
  { functional: true, dispatch: false },
);

export const requestPasswordReset$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(requestPasswordReset),
      switchMap(({ email }) =>
        authService.requestPasswordReset(email).pipe(
          map(() => requestPasswordResetSuccess({ email })),
          catchError((error) => of(requestPasswordResetFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const requestPasswordResetSuccessRedirect$ = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) => {
    return actions$.pipe(
      ofType(requestPasswordResetSuccess),
      tap(({ email }) => {
        router.navigate(['/request-password-reset-confirmation'], {
          queryParams: email ? { email } : {},
        });
      }),
    );
  },
  { functional: true, dispatch: false },
);

export const resetPassword$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(resetPassword),
      switchMap(({ email, code, newPassword }) =>
        authService.resetPassword(email, code, newPassword).pipe(
          map(() => resetPasswordSuccess()),
          catchError((error) => of(resetPasswordFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const resetPasswordSuccessRedirect$ = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) => {
    return actions$.pipe(
      ofType(resetPasswordSuccess),
      tap(() => {
        router.navigate(['/login']);
      }),
    );
  },
  { functional: true, dispatch: false },
);

export const changePassword$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(changePassword),
      switchMap(({ currentPassword, newPassword, newPasswordConfirmation }) =>
        authService.changePassword(currentPassword, newPassword, newPasswordConfirmation).pipe(
          map((response) => {
            localStorage.setItem(USERS_JWT_STORAGE_KEY, response.access_token);

            return changePasswordSuccess();
          }),
          catchError((error) => of(changePasswordFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

// --- Admin users effects ---

const USERS_BATCH_SIZE = 10;

export const loadUsers$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(loadUsers),
      switchMap(() => {
        const batchParams = { limit: USERS_BATCH_SIZE, offset: 0 };

        return authService.listUsers(batchParams).pipe(
          switchMap((users) => {
            if (users.length === 0) {
              return of(loadUsersSuccess({ users: [] }));
            }

            if (users.length < USERS_BATCH_SIZE) {
              return of(loadUsersSuccess({ users }));
            }

            return of(loadUsersBatch({ offset: USERS_BATCH_SIZE, accumulatedUsers: users }));
          }),
          catchError((error) => of(loadUsersFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadUsersBatch$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(loadUsersBatch),
      switchMap(({ offset, accumulatedUsers }) => {
        const batchParams = { limit: USERS_BATCH_SIZE, offset };

        return authService.listUsers(batchParams).pipe(
          switchMap((users) => {
            const newAccumulated = [...accumulatedUsers, ...users];

            if (users.length === 0) {
              return of(loadUsersSuccess({ users: newAccumulated }));
            }

            if (users.length < USERS_BATCH_SIZE) {
              return of(loadUsersSuccess({ users: newAccumulated }));
            }

            return of(loadUsersBatch({ offset: offset + USERS_BATCH_SIZE, accumulatedUsers: newAccumulated }));
          }),
          catchError((error) => of(loadUsersFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const createUser$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(createUser),
      switchMap(({ user }) =>
        authService.createUser(user).pipe(
          map((created) => createUserSuccess({ user: created })),
          catchError((error) => of(createUserFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateUser$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(updateUser),
      switchMap(({ id, user }) =>
        authService.updateUser(id, user).pipe(
          map((updated) => updateUserSuccess({ user: updated })),
          catchError((error) => of(updateUserFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteUser$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(deleteUser),
      switchMap(({ id }) =>
        authService.deleteUser(id).pipe(
          map(() => deleteUserSuccess({ id })),
          catchError((error) => of(deleteUserFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const lockUser$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(lockUser),
      switchMap(({ id }) =>
        authService.lockUser(id).pipe(
          map((user) => lockUserSuccess({ user })),
          catchError((error) => of(lockUserFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const unlockUser$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(unlockUser),
      switchMap(({ id }) =>
        authService.unlockUser(id).pipe(
          map((user) => unlockUserSuccess({ user })),
          catchError((error) => of(unlockUserFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

// --- Login 2FA self-service effects ---

export const loadTwoFactorStatus$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(loadTwoFactorStatus),
      switchMap(() =>
        authService.getTwoFactorStatus().pipe(
          map((status) => loadTwoFactorStatusSuccess({ status })),
          catchError((error) => of(loadTwoFactorStatusFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const enableEmail2fa$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(enableEmail2fa),
      switchMap(({ code }) =>
        authService.enableEmail2fa(code).pipe(
          map((res) => enableEmail2faSuccess({ message: res.message, pending: res.pending })),
          catchError((error) => of(enableEmail2faFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const disableEmail2fa$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(disableEmail2fa),
      switchMap(({ currentPassword }) =>
        authService.disableEmail2fa(currentPassword).pipe(
          map((res) => disableEmail2faSuccess({ message: res.message })),
          catchError((error) => of(disableEmail2faFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const setupTotp$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(setupTotp),
      switchMap(({ currentPassword }) =>
        authService.setupTotp(currentPassword).pipe(
          map((setup) => setupTotpSuccess({ setup })),
          catchError((error) => of(setupTotpFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const confirmTotp$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(confirmTotp),
      switchMap(({ code }) =>
        authService.confirmTotp(code).pipe(
          map((res) => {
            localStorage.setItem(USERS_JWT_STORAGE_KEY, res.access_token);

            return confirmTotpSuccess({ message: res.message });
          }),
          catchError((error) => of(confirmTotpFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const disableTotp$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(disableTotp),
      switchMap(({ code }) =>
        authService.disableTotp(code).pipe(
          map((res) => {
            localStorage.setItem(USERS_JWT_STORAGE_KEY, res.access_token);

            return disableTotpSuccess({ message: res.message });
          }),
          catchError((error) => of(disableTotpFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const adminClearTotp$ = createEffect(
  (actions$ = inject(Actions), authService = inject(AuthService)) => {
    return actions$.pipe(
      ofType(adminClearTotp),
      switchMap(({ userId }) =>
        authService.adminClearUserTotp(userId).pipe(
          map((res) => adminClearTotpSuccess({ message: res.message, userId })),
          catchError((error) => of(adminClearTotpFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

/** Reload 2FA status after successful self-service mutations (except pending email confirm). */
export const reloadTwoFactorStatusAfterMutation$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(enableEmail2faSuccess, disableEmail2faSuccess, confirmTotpSuccess, disableTotpSuccess),
      filter((action) => !(action.type === enableEmail2faSuccess.type && action.pending === true)),
      map(() => loadTwoFactorStatus()),
    );
  },
  { functional: true },
);
