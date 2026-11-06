import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import {
  createMockIdentityAuthEnvironment,
  IDENTITY_AUTH_ENVIRONMENT,
  OidcAuthService,
} from '@forepath/identity/frontend';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { LOGIN_SUCCESS_REDIRECT_TARGET } from '../../services/auth.service';

import {
  changePassword,
  changePasswordFailure,
  changePasswordSuccess,
  checkAuthentication,
  checkAuthenticationSuccess,
  confirmEmailSuccess,
  loadUsers,
  loadUsersBatch,
  loadUsersFailure,
  loadUsersSuccess,
  lockUser,
  lockUserFailure,
  lockUserSuccess,
  login,
  loginFailure,
  loginSuccess,
  logout,
  logoutFailure,
  logoutSuccess,
  registerSuccess,
  requestPasswordResetSuccess,
  resetPasswordSuccess,
  unlockUser,
  unlockUserFailure,
  unlockUserSuccess,
} from './authentication.actions';
import {
  checkAuthentication$,
  changePassword$,
  confirmEmailSuccessRedirect$,
  loadUsers$,
  loadUsersBatch$,
  lockUser$,
  login$,
  loginEmailNotConfirmedRedirect$,
  loginSuccessRedirect$,
  loginTwoFactorRequiredRedirect$,
  logout$,
  logoutSuccessRedirect$,
  registerSuccessRedirect$,
  requestPasswordResetSuccessRedirect$,
  resetPasswordSuccessRedirect$,
  unlockUser$,
} from './authentication.effects';
import type { UserResponseDto } from './authentication.types';

// Avoid real browser navigation: SAML sign-in leaves the app via `location.assign`.
jest.mock('../../../../../util-auth/src/lib/saml-login.utils', () => ({
  ...jest.requireActual('../../../../../util-auth/src/lib/saml-login.utils'),
  startSamlLogin: jest.fn().mockResolvedValue(undefined),
}));

const { startSamlLogin } = jest.requireMock('../../../../../util-auth/src/lib/saml-login.utils') as {
  startSamlLogin: jest.Mock;
};

describe('AuthenticationEffects', () => {
  let actions$: Actions;
  let mockAuthEnvironment: IdentityAuthEnvironment;
  let mockOidcAuthService: {
    login: jest.Mock;
    logout: jest.Mock;
    isLoggedIn: jest.Mock;
    getProfile: jest.Mock;
  };
  let mockRouter: jest.Mocked<Partial<Router>>;
  const API_KEY_STORAGE_KEY = 'agent-controller-api-key';

  beforeEach(() => {
    // Setup localStorage mock
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
      },
      writable: true,
    });

    mockAuthEnvironment = createMockIdentityAuthEnvironment();

    mockOidcAuthService = {
      login: jest.fn(),
      logout: jest.fn(),
      isLoggedIn: jest.fn(),
      getProfile: jest.fn().mockReturnValue(null),
    };

    mockRouter = {
      navigate: jest.fn().mockResolvedValue(true),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        {
          provide: IDENTITY_AUTH_ENVIRONMENT,
          useValue: mockAuthEnvironment,
        },
        {
          provide: OidcAuthService,
          useValue: mockOidcAuthService,
        },
        {
          provide: Router,
          useValue: mockRouter,
        },
        {
          provide: LOGIN_SUCCESS_REDIRECT_TARGET,
          useValue: ['/clients'],
        },
      ],
    });

    actions$ = TestBed.inject(Actions);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    (window.localStorage.getItem as jest.Mock).mockClear();
    (window.localStorage.setItem as jest.Mock).mockClear();
    (window.localStorage.removeItem as jest.Mock).mockClear();
  });

  describe('login$', () => {
    describe('when authentication type is api-key', () => {
      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: {
            type: 'api-key',
            apiKey: 'env-api-key',
          },
        });
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [
            provideMockActions(() => actions$),
            {
              provide: IDENTITY_AUTH_ENVIRONMENT,
              useValue: mockAuthEnvironment,
            },
            {
              provide: OidcAuthService,
              useValue: mockOidcAuthService,
            },
            {
              provide: LOGIN_SUCCESS_REDIRECT_TARGET,
              useValue: ['/clients'],
            },
          ],
        });
      });

      it('should store API key from payload in localStorage and return loginSuccess', (done) => {
        const action = login({ apiKey: 'test-api-key' });
        const outcome = loginSuccess({ authenticationType: 'api-key' });

        actions$ = of(action);

        login$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(window.localStorage.setItem).toHaveBeenCalledWith(API_KEY_STORAGE_KEY, 'test-api-key');
          done();
        });
      });

      it('should use environment API key if payload apiKey is not provided', (done) => {
        const action = login({});
        const outcome = loginSuccess({ authenticationType: 'api-key' });

        actions$ = of(action);

        login$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(window.localStorage.setItem).toHaveBeenCalledWith(API_KEY_STORAGE_KEY, 'env-api-key');
          done();
        });
      });

      it('should return loginFailure if no API key is available', (done) => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: {
            type: 'api-key',
          },
        });
        const action = login({});
        const outcome = loginFailure({ error: 'API key is required for authentication' });

        actions$ = of(action);

        login$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(window.localStorage.setItem).not.toHaveBeenCalled();
          done();
        });
      });
    });

    describe('when authentication type is oidc', () => {
      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: { type: 'oidc', issuer: 'https://idp.example.com', clientId: 'console' },
        });
      });

      it('should redirect to the identity provider without emitting', (done) => {
        actions$ = of(login({}));
        mockOidcAuthService.login.mockResolvedValue(undefined);
        const results: unknown[] = [];

        login$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe({
          next: (result) => results.push(result),
          complete: () => {
            expect(mockOidcAuthService.login).toHaveBeenCalled();
            expect(results).toEqual([]);
            done();
          },
        });
      });

      it('should return loginFailure when the redirect cannot start', (done) => {
        actions$ = of(login({}));
        mockOidcAuthService.login.mockRejectedValue(new Error('discovery failed'));

        login$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(loginFailure({ error: 'discovery failed' }));
          done();
        });
      });
    });

    describe('when authentication type is saml', () => {
      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({ authentication: { type: 'saml' } });
        startSamlLogin.mockClear();
      });

      it('should start SAML sign-in at the API without emitting', (done) => {
        actions$ = of(login({}));
        const results: unknown[] = [];

        login$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe({
          next: (result) => results.push(result),
          complete: () => {
            expect(startSamlLogin).toHaveBeenCalledWith('http://localhost:3100/api', undefined, undefined);
            expect(results).toEqual([]);
            done();
          },
        });
      });
    });

    describe('when authentication type is users', () => {
      let mockAuthService: { login: jest.Mock };

      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: {
            type: 'users',
          },
        });
        mockAuthService = {
          login: jest.fn(),
        };
      });

      it('should include confirmEmail on loginFailure when email is not confirmed', (done) => {
        const action = login({ email: 'pending@example.com', password: 'password123' });
        const outcome = loginFailure({
          error: 'Email not confirmed. Please confirm your email before logging in.',
          confirmEmail: 'pending@example.com',
        });

        actions$ = of(action);
        mockAuthService.login.mockReturnValue(
          throwError(
            () =>
              new HttpErrorResponse({
                status: 401,
                error: {
                  message: 'Email not confirmed. Please confirm your email before logging in.',
                  code: 'EMAIL_NOT_CONFIRMED',
                },
              }),
          ),
        );

        login$(actions$, mockAuthEnvironment, null, mockAuthService as any).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });

      it('should include login2fa on loginFailure when LOGIN_2FA_REQUIRED', (done) => {
        Object.defineProperty(window, 'sessionStorage', {
          value: {
            getItem: jest.fn(),
            setItem: jest.fn(),
            removeItem: jest.fn(),
            clear: jest.fn(),
          },
          writable: true,
        });

        const action = login({ email: 'user@example.com', password: 'password123' });
        const outcome = loginFailure({
          error: 'Two-factor authentication required. Enter the verification code to continue.',
          login2fa: { email: 'user@example.com', password: 'password123', method: 'email' },
        });

        actions$ = of(action);
        mockAuthService.login.mockReturnValue(
          throwError(
            () =>
              new HttpErrorResponse({
                status: 401,
                error: {
                  message: 'Two-factor authentication required. Enter the verification code to continue.',
                  code: 'LOGIN_2FA_REQUIRED',
                  method: 'email',
                },
              }),
          ),
        );

        login$(actions$, mockAuthEnvironment, null, mockAuthService as any).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(window.sessionStorage.setItem).toHaveBeenCalledWith('identity-pending-login-password', 'password123');
          done();
        });
      });

      it('should keep a plain loginFailure when LOGIN_2FA_INVALID is returned', (done) => {
        Object.defineProperty(window, 'sessionStorage', {
          value: {
            getItem: jest.fn(),
            setItem: jest.fn(),
            removeItem: jest.fn(),
            clear: jest.fn(),
          },
          writable: true,
        });

        const action = login({ email: 'user@example.com', password: 'password123', code: '000000' });
        const outcome = loginFailure({
          error: 'Invalid verification code. Please try again.',
        });

        actions$ = of(action);
        mockAuthService.login.mockReturnValue(
          throwError(
            () =>
              new HttpErrorResponse({
                status: 401,
                error: {
                  message: 'Invalid verification code. Please try again.',
                  code: 'LOGIN_2FA_INVALID',
                  method: 'totp',
                },
              }),
          ),
        );

        login$(actions$, mockAuthEnvironment, null, mockAuthService as any).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(window.sessionStorage.setItem).not.toHaveBeenCalled();
          done();
        });
      });
    });
  });

  describe('logout$', () => {
    describe('when authentication type is api-key', () => {
      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: {
            type: 'api-key',
          },
        });
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [
            provideMockActions(() => actions$),
            {
              provide: IDENTITY_AUTH_ENVIRONMENT,
              useValue: mockAuthEnvironment,
            },
            {
              provide: OidcAuthService,
              useValue: mockOidcAuthService,
            },
            {
              provide: LOGIN_SUCCESS_REDIRECT_TARGET,
              useValue: ['/clients'],
            },
          ],
        });
      });

      it('should remove API key from localStorage and return logoutSuccess', (done) => {
        const action = logout({});
        const outcome = logoutSuccess();

        actions$ = of(action);

        logout$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(window.localStorage.removeItem).toHaveBeenCalledWith(API_KEY_STORAGE_KEY);
          done();
        });
      });
    });

    describe('when authentication type is oidc', () => {
      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: { type: 'oidc', issuer: 'https://idp.example.com', clientId: 'console' },
        });
      });

      it('should log out at the provider and return logoutSuccess', (done) => {
        actions$ = of(logout({}));
        mockOidcAuthService.logout.mockResolvedValue(undefined);

        logout$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(logoutSuccess());
          expect(mockOidcAuthService.logout).toHaveBeenCalled();
          done();
        });
      });

      it('should return logoutFailure on provider logout error', (done) => {
        actions$ = of(logout({}));
        mockOidcAuthService.logout.mockRejectedValue(new Error('OIDC logout failed'));

        logout$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(logoutFailure({ error: 'OIDC logout failed' }));
          done();
        });
      });
    });

    describe('when authentication type is saml', () => {
      it('should revoke the session at the API and clear the session JWT', (done) => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({ authentication: { type: 'saml' } });
        const authService = { logout: jest.fn().mockReturnValue(of(undefined)) };

        actions$ = of(logout({ invalidateAllSessions: true }));

        logout$(actions$, mockAuthEnvironment, mockOidcAuthService as any, authService as any).subscribe((result) => {
          expect(result).toEqual(logoutSuccess());
          expect(authService.logout).toHaveBeenCalledWith(true);
          expect(window.localStorage.removeItem).toHaveBeenCalledWith('agent-controller-users-jwt');
          done();
        });
      });
    });

    describe('when authentication type is users', () => {
      const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';
      let mockAuthService: { logout: jest.Mock; changePassword: jest.Mock };

      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: {
            type: 'users',
          },
        });
        mockAuthService = {
          logout: jest.fn().mockReturnValue(of(undefined)),
          changePassword: jest.fn(),
        };
      });

      it('should call logout API, remove JWT from localStorage, and return logoutSuccess', (done) => {
        const action = logout({});
        const outcome = logoutSuccess();

        actions$ = of(action);

        logout$(actions$, mockAuthEnvironment, null, mockAuthService as any).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(mockAuthService.logout).toHaveBeenCalled();
          expect(window.localStorage.removeItem).toHaveBeenCalledWith(USERS_JWT_STORAGE_KEY);
          done();
        });
      });

      it('should still clear JWT and return logoutSuccess when logout API fails', (done) => {
        const action = logout({});
        const outcome = logoutSuccess();

        actions$ = of(action);
        mockAuthService.logout.mockReturnValue(throwError(() => new Error('network error')));

        logout$(actions$, mockAuthEnvironment, null, mockAuthService as any).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(window.localStorage.removeItem).toHaveBeenCalledWith(USERS_JWT_STORAGE_KEY);
          done();
        });
      });
    });
  });

  describe('changePassword$', () => {
    const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';
    let mockAuthService: { changePassword: jest.Mock };

    beforeEach(() => {
      mockAuthService = {
        changePassword: jest
          .fn()
          .mockReturnValue(of({ message: 'Password changed successfully.', access_token: 'new-jwt-token' })),
      };
    });

    it('should store new access token and return changePasswordSuccess', (done) => {
      const action = changePassword({
        currentPassword: 'old',
        newPassword: 'new',
        newPasswordConfirmation: 'new',
      });
      const outcome = changePasswordSuccess({ message: 'Password changed successfully.' });

      actions$ = of(action);

      changePassword$(actions$, mockAuthService as any).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(mockAuthService.changePassword).toHaveBeenCalledWith('old', 'new', 'new');
        expect(window.localStorage.setItem).toHaveBeenCalledWith(USERS_JWT_STORAGE_KEY, 'new-jwt-token');
        done();
      });
    });

    it('should return changePasswordFailure on error', (done) => {
      const action = changePassword({
        currentPassword: 'old',
        newPassword: 'new',
        newPasswordConfirmation: 'new',
      });

      actions$ = of(action);
      mockAuthService.changePassword.mockReturnValue(throwError(() => new Error('Current password is incorrect')));

      changePassword$(actions$, mockAuthService as any).subscribe((result) => {
        expect(result).toEqual(changePasswordFailure({ error: 'Current password is incorrect' }));
        done();
      });
    });
  });

  describe('checkAuthentication$', () => {
    describe('when authentication type is api-key', () => {
      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: {
            type: 'api-key',
            apiKey: 'env-api-key',
          },
        });
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [
            provideMockActions(() => actions$),
            {
              provide: IDENTITY_AUTH_ENVIRONMENT,
              useValue: mockAuthEnvironment,
            },
            {
              provide: OidcAuthService,
              useValue: mockOidcAuthService,
            },
            {
              provide: LOGIN_SUCCESS_REDIRECT_TARGET,
              useValue: ['/clients'],
            },
          ],
        });
      });

      it('should return checkAuthenticationSuccess with true and authenticationType if API key exists in environment', (done) => {
        const action = checkAuthentication();
        const outcome = checkAuthenticationSuccess({ isAuthenticated: true, authenticationType: 'api-key' });

        actions$ = of(action);
        (window.localStorage.getItem as jest.Mock).mockReturnValue(null);

        checkAuthentication$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });

      it('should return checkAuthenticationSuccess with true and authenticationType if API key exists in localStorage', (done) => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: {
            type: 'api-key',
          },
        });
        const action = checkAuthentication();
        const outcome = checkAuthenticationSuccess({ isAuthenticated: true, authenticationType: 'api-key' });

        actions$ = of(action);
        (window.localStorage.getItem as jest.Mock).mockReturnValue('stored-api-key');

        checkAuthentication$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(window.localStorage.getItem).toHaveBeenCalledWith(API_KEY_STORAGE_KEY);
          done();
        });
      });

      it('should return checkAuthenticationSuccess with false if no API key exists', (done) => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: {
            type: 'api-key',
          },
        });
        const action = checkAuthentication();
        const outcome = checkAuthenticationSuccess({ isAuthenticated: false });

        actions$ = of(action);
        (window.localStorage.getItem as jest.Mock).mockReturnValue(null);

        checkAuthentication$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });
    });

    describe('when authentication type is oidc', () => {
      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: { type: 'oidc', issuer: 'https://idp.example.com', clientId: 'console' },
        });
      });

      it('should report admin from the API probe, not from token claims', (done) => {
        mockOidcAuthService.isLoggedIn.mockReturnValue(true);
        mockOidcAuthService.getProfile.mockReturnValue({ sub: 'sub-1', email: 'admin@example.com' });
        const authService = { probeAdminAccess: jest.fn().mockReturnValue(of(true)) };

        actions$ = of(checkAuthentication());

        checkAuthentication$(actions$, mockAuthEnvironment, mockOidcAuthService as any, authService as any).subscribe(
          (result) => {
            expect(result).toEqual(
              checkAuthenticationSuccess({
                isAuthenticated: true,
                authenticationType: 'oidc',
                user: { id: 'sub-1', email: 'admin@example.com', role: 'admin' },
              }),
            );
            done();
          },
        );
      });

      it('should report a regular user when the probe is denied', (done) => {
        mockOidcAuthService.isLoggedIn.mockReturnValue(true);
        mockOidcAuthService.getProfile.mockReturnValue({ sub: 'sub-2' });
        const authService = { probeAdminAccess: jest.fn().mockReturnValue(of(false)) };

        actions$ = of(checkAuthentication());

        checkAuthentication$(actions$, mockAuthEnvironment, mockOidcAuthService as any, authService as any).subscribe(
          (result) => {
            expect(result).toEqual(
              checkAuthenticationSuccess({
                isAuthenticated: true,
                authenticationType: 'oidc',
                user: { id: 'sub-2', email: '', role: 'user' },
              }),
            );
            done();
          },
        );
      });

      it('should return not authenticated without a session', (done) => {
        mockOidcAuthService.isLoggedIn.mockReturnValue(false);
        const authService = { probeAdminAccess: jest.fn() };

        actions$ = of(checkAuthentication());

        checkAuthentication$(actions$, mockAuthEnvironment, mockOidcAuthService as any, authService as any).subscribe(
          (result) => {
            expect(result).toEqual(checkAuthenticationSuccess({ isAuthenticated: false }));
            expect(authService.probeAdminAccess).not.toHaveBeenCalled();
            done();
          },
        );
      });
    });

    describe('when authentication type is saml', () => {
      it('should read the session JWT like users mode', (done) => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({ authentication: { type: 'saml' } });
        const payload = {
          sub: 'u1',
          email: 'a@b.c',
          roles: ['admin'],
          amr: ['saml'],
          exp: Math.floor(Date.now() / 1000) + 600,
        };
        const jwt = `h.${btoa(JSON.stringify(payload))}.s`;

        (window.localStorage.getItem as jest.Mock).mockReturnValue(jwt);
        actions$ = of(checkAuthentication());

        checkAuthentication$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(
            checkAuthenticationSuccess({
              isAuthenticated: true,
              authenticationType: 'saml',
              user: { id: 'u1', email: 'a@b.c', role: 'admin' },
            }),
          );
          done();
        });
      });

      it('should reject PAT JWTs', (done) => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({ authentication: { type: 'saml' } });
        const payload = {
          sub: 'u1',
          email: 'a@b.c',
          roles: ['admin'],
          amr: ['pat'],
          exp: Math.floor(Date.now() / 1000) + 600,
        };

        (window.localStorage.getItem as jest.Mock).mockReturnValue(`h.${btoa(JSON.stringify(payload))}.s`);
        actions$ = of(checkAuthentication());

        checkAuthentication$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(checkAuthenticationSuccess({ isAuthenticated: false }));
          done();
        });
      });
    });

    describe('when authentication type is users', () => {
      const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';

      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: {
            type: 'users',
          },
        });
      });

      it('returns authenticated for a valid password JWT', (done) => {
        const exp = Math.floor((Date.now() + 3600000) / 1000);
        const payload = btoa(JSON.stringify({ sub: 'user-1', email: 'a@b.c', exp, roles: ['admin'], amr: ['pwd'] }));
        const jwt = `header.${payload}.signature`;

        actions$ = of(checkAuthentication());
        (window.localStorage.getItem as jest.Mock).mockImplementation((key: string) =>
          key === USERS_JWT_STORAGE_KEY ? jwt : null,
        );

        checkAuthentication$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(
            checkAuthenticationSuccess({
              isAuthenticated: true,
              authenticationType: 'users',
              user: { id: 'user-1', email: 'a@b.c', role: 'admin' },
            }),
          );
          done();
        });
      });

      it('clears PAT JWTs and reports unauthenticated', (done) => {
        const exp = Math.floor((Date.now() + 3600000) / 1000);
        const payload = btoa(JSON.stringify({ sub: 'user-1', email: 'a@b.c', exp, amr: ['pat'] }));
        const jwt = `header.${payload}.signature`;

        actions$ = of(checkAuthentication());
        (window.localStorage.getItem as jest.Mock).mockImplementation((key: string) =>
          key === USERS_JWT_STORAGE_KEY ? jwt : null,
        );

        checkAuthentication$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(checkAuthenticationSuccess({ isAuthenticated: false }));
          expect(window.localStorage.removeItem).toHaveBeenCalledWith(USERS_JWT_STORAGE_KEY);
          done();
        });
      });

      it('clears expired JWTs and reports unauthenticated', (done) => {
        const exp = Math.floor((Date.now() - 3600000) / 1000);
        const payload = btoa(JSON.stringify({ sub: 'user-1', email: 'a@b.c', exp, amr: ['pwd'] }));
        const jwt = `header.${payload}.signature`;

        actions$ = of(checkAuthentication());
        (window.localStorage.getItem as jest.Mock).mockImplementation((key: string) =>
          key === USERS_JWT_STORAGE_KEY ? jwt : null,
        );

        checkAuthentication$(actions$, mockAuthEnvironment, mockOidcAuthService as any, null).subscribe((result) => {
          expect(result).toEqual(checkAuthenticationSuccess({ isAuthenticated: false }));
          expect(window.localStorage.removeItem).toHaveBeenCalledWith(USERS_JWT_STORAGE_KEY);
          done();
        });
      });
    });
  });

  describe('loginSuccessRedirect$', () => {
    it('should navigate to /clients when loginSuccess action is dispatched', (done) => {
      const action = loginSuccess({ authenticationType: 'api-key' });

      actions$ = of(action);
      mockRouter.navigate = jest.fn().mockResolvedValue(true);

      TestBed.runInInjectionContext(() => {
        loginSuccessRedirect$(actions$, mockRouter as any).subscribe({
          complete: () => {
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/clients']);
            expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
            done();
          },
        });
      });
    });

    it('should navigate to /clients for oidc authentication type', (done) => {
      const action = loginSuccess({ authenticationType: 'oidc' });

      actions$ = of(action);
      mockRouter.navigate = jest.fn().mockResolvedValue(true);

      TestBed.runInInjectionContext(() => {
        loginSuccessRedirect$(actions$, mockRouter as any).subscribe({
          complete: () => {
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/clients']);
            expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
            done();
          },
        });
      });
    });
  });

  describe('loginEmailNotConfirmedRedirect$', () => {
    it('should navigate to /confirm-email when loginFailure includes confirmEmail', (done) => {
      const action = loginFailure({
        error: 'Email not confirmed. Please confirm your email before logging in.',
        confirmEmail: 'test@example.com',
      });

      actions$ = of(action);
      mockRouter.navigate = jest.fn().mockResolvedValue(true);

      TestBed.runInInjectionContext(() => {
        loginEmailNotConfirmedRedirect$(actions$, mockRouter as any).subscribe({
          complete: () => {
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/confirm-email'], {
              queryParams: { email: 'test@example.com' },
            });
            done();
          },
        });
      });
    });

    it('should not navigate when loginFailure has no confirmEmail', (done) => {
      const action = loginFailure({ error: 'Invalid email or password' });

      actions$ = of(action);
      mockRouter.navigate = jest.fn().mockResolvedValue(true);

      TestBed.runInInjectionContext(() => {
        loginEmailNotConfirmedRedirect$(actions$, mockRouter as any).subscribe({
          complete: () => {
            expect(mockRouter.navigate).not.toHaveBeenCalled();
            done();
          },
        });
      });
    });
  });

  describe('loginTwoFactorRequiredRedirect$', () => {
    it('should navigate to /login-2fa when loginFailure includes login2fa', (done) => {
      const action = loginFailure({
        error: 'Two-factor authentication required. Enter the verification code to continue.',
        login2fa: { email: 'test@example.com', password: 'secret', method: 'totp' },
      });

      actions$ = of(action);
      mockRouter.navigate = jest.fn().mockResolvedValue(true);

      TestBed.runInInjectionContext(() => {
        loginTwoFactorRequiredRedirect$(actions$, mockRouter as any).subscribe({
          complete: () => {
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/login-2fa'], {
              queryParams: { email: 'test@example.com', method: 'totp' },
            });
            done();
          },
        });
      });
    });

    it('should not navigate when loginFailure has no login2fa', (done) => {
      const action = loginFailure({ error: 'Invalid email or password' });

      actions$ = of(action);
      mockRouter.navigate = jest.fn().mockResolvedValue(true);

      TestBed.runInInjectionContext(() => {
        loginTwoFactorRequiredRedirect$(actions$, mockRouter as any).subscribe({
          complete: () => {
            expect(mockRouter.navigate).not.toHaveBeenCalled();
            done();
          },
        });
      });
    });
  });

  describe('registerSuccessRedirect$', () => {
    it('should navigate to /confirm-email when email is not yet confirmed', (done) => {
      const action = registerSuccess({
        user: { id: 'user-1', email: 'test@example.com', role: 'user' },
        message: 'Registration successful',
        emailConfirmed: false,
      });

      actions$ = of(action);
      mockRouter.navigate = jest.fn().mockResolvedValue(true);

      TestBed.runInInjectionContext(() => {
        registerSuccessRedirect$(actions$, mockRouter as any).subscribe({
          complete: () => {
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/confirm-email'], {
              queryParams: { email: 'test@example.com' },
            });
            expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
            done();
          },
        });
      });
    });

    it('should navigate to /login when email is already confirmed', (done) => {
      const action = registerSuccess({
        user: { id: 'user-1', email: 'admin@example.com', role: 'admin' },
        message: 'Account created successfully. You can log in immediately.',
        emailConfirmed: true,
      });

      actions$ = of(action);
      mockRouter.navigate = jest.fn().mockResolvedValue(true);

      TestBed.runInInjectionContext(() => {
        registerSuccessRedirect$(actions$, mockRouter as any).subscribe({
          complete: () => {
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
            expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
            done();
          },
        });
      });
    });
  });

  describe('requestPasswordResetSuccessRedirect$', () => {
    it('should navigate to /request-password-reset-confirmation when requestPasswordResetSuccess action is dispatched', (done) => {
      const action = requestPasswordResetSuccess({ email: 'user@example.com' });

      actions$ = of(action);
      mockRouter.navigate = jest.fn().mockResolvedValue(true);

      TestBed.runInInjectionContext(() => {
        requestPasswordResetSuccessRedirect$(actions$, mockRouter as any).subscribe({
          complete: () => {
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/request-password-reset-confirmation'], {
              queryParams: { email: 'user@example.com' },
            });
            expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
            done();
          },
        });
      });
    });
  });

  describe('resetPasswordSuccessRedirect$', () => {
    it('should navigate to /login when resetPasswordSuccess action is dispatched', (done) => {
      const action = resetPasswordSuccess();

      actions$ = of(action);
      mockRouter.navigate = jest.fn().mockResolvedValue(true);

      TestBed.runInInjectionContext(() => {
        resetPasswordSuccessRedirect$(actions$, mockRouter as any).subscribe({
          complete: () => {
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
            expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
            done();
          },
        });
      });
    });
  });

  describe('confirmEmailSuccessRedirect$', () => {
    it('should navigate to /login when confirmEmailSuccess action is dispatched', (done) => {
      const action = confirmEmailSuccess();

      actions$ = of(action);
      mockRouter.navigate = jest.fn().mockResolvedValue(true);

      TestBed.runInInjectionContext(() => {
        confirmEmailSuccessRedirect$(actions$, mockRouter as any).subscribe({
          complete: () => {
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
            expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
            done();
          },
        });
      });
    });
  });

  describe('logoutSuccessRedirect$', () => {
    it('should navigate to /login when logoutSuccess action is dispatched', (done) => {
      const action = logoutSuccess();

      actions$ = of(action);
      mockRouter.navigate = jest.fn().mockResolvedValue(true);

      TestBed.runInInjectionContext(() => {
        logoutSuccessRedirect$(actions$, mockRouter as any).subscribe({
          complete: () => {
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
            expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
            done();
          },
        });
      });
    });
  });

  describe('loadUsers$', () => {
    const mockAuthService = {
      listUsers: jest.fn(),
    } as any;
    const mockUser: UserResponseDto = {
      id: 'user-1',
      email: 'test@example.com',
      role: 'user',
      emailConfirmedAt: '2024-01-01T00:00:00Z',
      lockedAt: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    it('should return loadUsersSuccess when batch is empty', (done) => {
      const users: UserResponseDto[] = [];
      const action = loadUsers({});
      const outcome = loadUsersSuccess({ users: [] });

      actions$ = of(action);
      mockAuthService.listUsers.mockReturnValue(of(users));

      loadUsers$(actions$, mockAuthService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(mockAuthService.listUsers).toHaveBeenCalledWith({ limit: 10, offset: 0 });
        done();
      });
    });

    it('should return loadUsersSuccess when batch is partial (< 10)', (done) => {
      const users: UserResponseDto[] = [mockUser];
      const action = loadUsers({});
      const outcome = loadUsersSuccess({ users });

      actions$ = of(action);
      mockAuthService.listUsers.mockReturnValue(of(users));

      loadUsers$(actions$, mockAuthService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(mockAuthService.listUsers).toHaveBeenCalledWith({ limit: 10, offset: 0 });
        done();
      });
    });

    it('should return loadUsersBatch when batch is full (10 entries)', (done) => {
      const users: UserResponseDto[] = Array.from({ length: 10 }, (_, i) => ({
        ...mockUser,
        id: `user-${i}`,
      }));
      const action = loadUsers({});
      const outcome = loadUsersBatch({ offset: 10, accumulatedUsers: users });

      actions$ = of(action);
      mockAuthService.listUsers.mockReturnValue(of(users));

      loadUsers$(actions$, mockAuthService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(mockAuthService.listUsers).toHaveBeenCalledWith({ limit: 10, offset: 0 });
        done();
      });
    });

    it('should return loadUsersFailure on error', (done) => {
      const action = loadUsers({});
      const error = new Error('Load failed');
      const outcome = loadUsersFailure({ error: 'Load failed' });

      actions$ = of(action);
      mockAuthService.listUsers.mockReturnValue(throwError(() => error));

      loadUsers$(actions$, mockAuthService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadUsersBatch$', () => {
    const mockAuthService = {
      listUsers: jest.fn(),
    } as any;
    const mockUser: UserResponseDto = {
      id: 'user-1',
      email: 'test@example.com',
      role: 'user',
      emailConfirmedAt: '2024-01-01T00:00:00Z',
      lockedAt: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    it('should return loadUsersSuccess when batch is empty', (done) => {
      const accumulatedUsers: UserResponseDto[] = [mockUser];
      const newUsers: UserResponseDto[] = [];
      const action = loadUsersBatch({ offset: 10, accumulatedUsers });
      const outcome = loadUsersSuccess({ users: accumulatedUsers });

      actions$ = of(action);
      mockAuthService.listUsers.mockReturnValue(of(newUsers));

      loadUsersBatch$(actions$, mockAuthService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(mockAuthService.listUsers).toHaveBeenCalledWith({ limit: 10, offset: 10 });
        done();
      });
    });

    it('should return loadUsersSuccess when batch is partial (< 10)', (done) => {
      const accumulatedUsers: UserResponseDto[] = [mockUser];
      const newUsers: UserResponseDto[] = [{ ...mockUser, id: 'user-2' }];
      const action = loadUsersBatch({ offset: 10, accumulatedUsers });
      const outcome = loadUsersSuccess({ users: [...accumulatedUsers, ...newUsers] });

      actions$ = of(action);
      mockAuthService.listUsers.mockReturnValue(of(newUsers));

      loadUsersBatch$(actions$, mockAuthService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(mockAuthService.listUsers).toHaveBeenCalledWith({ limit: 10, offset: 10 });
        done();
      });
    });

    it('should return loadUsersBatch when batch is full (10 entries)', (done) => {
      const accumulatedUsers: UserResponseDto[] = Array.from({ length: 10 }, (_, i) => ({
        ...mockUser,
        id: `user-${i}`,
      }));
      const newUsers: UserResponseDto[] = Array.from({ length: 10 }, (_, i) => ({
        ...mockUser,
        id: `user-${i + 10}`,
      }));
      const action = loadUsersBatch({ offset: 10, accumulatedUsers });
      const outcome = loadUsersBatch({
        offset: 20,
        accumulatedUsers: [...accumulatedUsers, ...newUsers],
      });

      actions$ = of(action);
      mockAuthService.listUsers.mockReturnValue(of(newUsers));

      loadUsersBatch$(actions$, mockAuthService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(mockAuthService.listUsers).toHaveBeenCalledWith({ limit: 10, offset: 10 });
        done();
      });
    });

    it('should return loadUsersFailure on error', (done) => {
      const accumulatedUsers: UserResponseDto[] = [mockUser];
      const action = loadUsersBatch({ offset: 10, accumulatedUsers });
      const error = new Error('Load failed');
      const outcome = loadUsersFailure({ error: 'Load failed' });

      actions$ = of(action);
      mockAuthService.listUsers.mockReturnValue(throwError(() => error));

      loadUsersBatch$(actions$, mockAuthService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('lockUser$', () => {
    const mockAuthService = {
      lockUser: jest.fn(),
    } as any;

    it('should return lockUserSuccess on success', (done) => {
      const user: UserResponseDto = {
        id: 'user-1',
        email: 'locked@example.com',
        role: 'user',
        emailConfirmedAt: '2024-01-01T00:00:00Z',
        lockedAt: '2026-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      const action = lockUser({ id: 'user-1' });
      const outcome = lockUserSuccess({ user });

      actions$ = of(action);
      mockAuthService.lockUser.mockReturnValue(of(user));

      lockUser$(actions$, mockAuthService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(mockAuthService.lockUser).toHaveBeenCalledWith('user-1');
        done();
      });
    });

    it('should return lockUserFailure on error', (done) => {
      const action = lockUser({ id: 'user-1' });
      const error = new Error('Lock failed');
      const outcome = lockUserFailure({ error: 'Lock failed' });

      actions$ = of(action);
      mockAuthService.lockUser.mockReturnValue(throwError(() => error));

      lockUser$(actions$, mockAuthService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('unlockUser$', () => {
    const mockAuthService = {
      unlockUser: jest.fn(),
    } as any;

    it('should return unlockUserSuccess on success', (done) => {
      const user: UserResponseDto = {
        id: 'user-1',
        email: 'active@example.com',
        role: 'user',
        emailConfirmedAt: '2024-01-01T00:00:00Z',
        lockedAt: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      const action = unlockUser({ id: 'user-1' });
      const outcome = unlockUserSuccess({ user });

      actions$ = of(action);
      mockAuthService.unlockUser.mockReturnValue(of(user));

      unlockUser$(actions$, mockAuthService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(mockAuthService.unlockUser).toHaveBeenCalledWith('user-1');
        done();
      });
    });

    it('should return unlockUserFailure on error', (done) => {
      const action = unlockUser({ id: 'user-1' });
      const error = new Error('Unlock failed');
      const outcome = unlockUserFailure({ error: 'Unlock failed' });

      actions$ = of(action);
      mockAuthService.unlockUser.mockReturnValue(throwError(() => error));

      unlockUser$(actions$, mockAuthService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });
});
