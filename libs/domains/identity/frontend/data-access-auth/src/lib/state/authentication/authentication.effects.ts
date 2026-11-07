import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import {
  clearMtlsCredential,
  hasMtlsCredential,
  IDENTITY_AUTH_ENVIRONMENT,
  importMtlsCredential,
  jwtPayloadHasPatAmr,
  MtlsCredentialError,
  OidcAuthService,
  parseJwtPayload,
  saveMtlsCredential,
  startSamlLogin,
  usesAppSessionJwt,
} from '@forepath/identity/frontend';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, EMPTY, filter, from, map, of, switchMap, tap } from 'rxjs';

import {
  consumePostLoginReturnUrl,
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

/** Reads a selected file; certificate files are small text (PEM). */
function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Max accepted size of a selected certificate / key file (PEM bundles are a few KB). */
const MAX_CERTIFICATE_FILE_BYTES = 256 * 1024;

/** mtls: import the selected certificate (+ key) as a non-extractable signing credential and store it. */
async function importCertificateFiles(certificate: Blob, privateKey?: Blob): Promise<void> {
  if (certificate.size > MAX_CERTIFICATE_FILE_BYTES || (privateKey?.size ?? 0) > MAX_CERTIFICATE_FILE_BYTES) {
    throw new MtlsCredentialError('The selected file is too large to be a PEM certificate or key.');
  }

  const [certificateText, privateKeyText] = await Promise.all([
    readBlobText(certificate),
    privateKey ? readBlobText(privateKey) : Promise.resolve(undefined),
  ]);
  const credential = await importMtlsCredential(certificateText, privateKeyText);

  await saveMtlsCredential(credential);
}

export const login$ = createEffect(
  (
    actions$ = inject(Actions),
    authEnvironment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT),
    oidcAuthService = inject(OidcAuthService),
    authService = inject(AuthService, { optional: true }),
  ) => {
    return actions$.pipe(
      ofType(login),
      switchMap(({ apiKey, email, password, code, certificate, privateKey }) => {
        if (authEnvironment.authentication.type === 'mtls') {
          if (!certificate) {
            return of(loginFailure({ error: 'A client certificate is required for authentication' }));
          }

          return from(importCertificateFiles(certificate, privateKey)).pipe(
            map(() => loginSuccess({ authenticationType: 'mtls' })),
            catchError((error) =>
              of(
                loginFailure({
                  error:
                    error instanceof MtlsCredentialError
                      ? error.message
                      : 'The certificate could not be read. Select a PEM certificate and its private key.',
                }),
              ),
            ),
          );
        }

        if (authEnvironment.authentication.type === 'api-key') {
          const keyToStore = apiKey || authEnvironment.authentication.apiKey;

          if (keyToStore) {
            localStorage.setItem(API_KEY_STORAGE_KEY, keyToStore);

            return of(loginSuccess({ authenticationType: 'api-key' }));
          }

          return of(loginFailure({ error: 'API key is required for authentication' }));
        }

        // External sign-in: the browser leaves for the identity provider; the session is established on return
        // (OIDC: app initializer, SAML: /login/saml/callback). Resume the grant page when login started there.
        if (authEnvironment.authentication.type === 'oidc') {
          return from(oidcAuthService.login(consumePostLoginReturnUrl() ?? undefined)).pipe(
            switchMap(() => EMPTY),
            catchError((error) => of(loginFailure({ error: normalizeError(error) }))),
          );
        }

        if (authEnvironment.authentication.type === 'saml') {
          return from(
            startSamlLogin(authEnvironment.apiUrl, consumePostLoginReturnUrl() ?? undefined, authEnvironment.tenantId),
          ).pipe(
            switchMap(() => EMPTY),
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
        // Resume the app grant page when login was started from it (allowlisted in-app URL only).
        const returnUrl = consumePostLoginReturnUrl();

        if (returnUrl) {
          router.navigateByUrl(returnUrl);

          return;
        }

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
    oidcAuthService = inject(OidcAuthService),
    authService = inject(AuthService, { optional: true }),
  ) => {
    return actions$.pipe(
      ofType(logout),
      switchMap(({ invalidateAllSessions }) => {
        if (authEnvironment.authentication.type === 'api-key') {
          localStorage.removeItem(API_KEY_STORAGE_KEY);

          return of(logoutSuccess());
        }

        if (authEnvironment.authentication.type === 'mtls') {
          return from(clearMtlsCredential()).pipe(
            map(() => logoutSuccess()),
            catchError(() => of(logoutSuccess())),
          );
        }

        if (authEnvironment.authentication.type === 'oidc') {
          return from(oidcAuthService.logout()).pipe(
            map(() => logoutSuccess()),
            catchError((error) => of(logoutFailure({ error: normalizeError(error) }))),
          );
        }

        // users / saml: revoke the session JWT at the API, then drop it locally either way.
        if (usesAppSessionJwt(authEnvironment.authentication.type) && authService) {
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

        if (usesAppSessionJwt(authEnvironment.authentication.type)) {
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
    oidcAuthService = inject(OidcAuthService),
    authService = inject(AuthService, { optional: true }),
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

        if (authEnvironment.authentication.type === 'mtls') {
          return from(hasMtlsCredential()).pipe(
            map((isAuthenticated) =>
              checkAuthenticationSuccess({
                isAuthenticated,
                authenticationType: isAuthenticated ? 'mtls' : undefined,
              }),
            ),
            catchError(() => of(checkAuthenticationSuccess({ isAuthenticated: false }))),
          );
        }

        if (authEnvironment.authentication.type === 'oidc') {
          if (!oidcAuthService.isLoggedIn()) {
            return of(checkAuthenticationSuccess({ isAuthenticated: false }));
          }

          const profile = oidcAuthService.getProfile();
          // Roles live in the API's users table (never in IdP claims): ask the API instead of reading the token.
          const isAdmin$ = authService ? authService.probeAdminAccess() : of(false);

          return isAdmin$.pipe(
            map((isAdmin) =>
              checkAuthenticationSuccess({
                isAuthenticated: true,
                authenticationType: 'oidc',
                user: profile
                  ? { id: profile.sub, email: profile.email ?? '', role: isAdmin ? 'admin' : 'user' }
                  : undefined,
              }),
            ),
            catchError((error) => of(checkAuthenticationFailure({ error: normalizeError(error) }))),
          );
        }

        if (usesAppSessionJwt(authEnvironment.authentication.type)) {
          const sessionType = authEnvironment.authentication.type as 'users' | 'saml';
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
                  authenticationType: isAuthenticated ? sessionType : undefined,
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

            return changePasswordSuccess({ message: response.message });
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
