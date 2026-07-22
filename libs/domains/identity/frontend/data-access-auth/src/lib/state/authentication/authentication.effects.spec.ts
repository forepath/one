import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import { createMockIdentityAuthEnvironment, IDENTITY_AUTH_ENVIRONMENT } from '@forepath/identity/frontend';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { KeycloakService } from 'keycloak-angular';
import { of, throwError } from 'rxjs';

import { LOGIN_SUCCESS_REDIRECT_TARGET } from '../../services/auth.service';

import {
  changePassword,
  changePasswordFailure,
  changePasswordSuccess,
  checkAuthentication,
  checkAuthenticationFailure,
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
  logout$,
  logoutSuccessRedirect$,
  registerSuccessRedirect$,
  requestPasswordResetSuccessRedirect$,
  resetPasswordSuccessRedirect$,
  unlockUser$,
} from './authentication.effects';
import type { UserResponseDto } from './authentication.types';

// Mock keycloak-angular to avoid ES module import issues with keycloak-js in Jest.
// createAuthGuard is called at module load time by keycloak.guard.ts (re-exported via barrel).
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
  createAuthGuard: jest.fn().mockReturnValue(() => Promise.resolve(true)),
}));

describe('AuthenticationEffects', () => {
  let actions$: Actions;
  let mockAuthEnvironment: IdentityAuthEnvironment;
  let mockKeycloakService: jest.Mocked<Partial<KeycloakService>>;
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

    mockKeycloakService = {
      login: jest.fn(),
      logout: jest.fn(),
      isLoggedIn: jest.fn(),
      getKeycloakInstance: jest.fn().mockReturnValue(undefined),
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
          provide: KeycloakService,
          useValue: mockKeycloakService,
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
              provide: KeycloakService,
              useValue: mockKeycloakService,
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

        login$(actions$, mockAuthEnvironment, mockKeycloakService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(window.localStorage.setItem).toHaveBeenCalledWith(API_KEY_STORAGE_KEY, 'test-api-key');
          done();
        });
      });

      it('should use environment API key if payload apiKey is not provided', (done) => {
        const action = login({});
        const outcome = loginSuccess({ authenticationType: 'api-key' });

        actions$ = of(action);

        login$(actions$, mockAuthEnvironment, mockKeycloakService as any, null).subscribe((result) => {
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

        login$(actions$, mockAuthEnvironment, mockKeycloakService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(window.localStorage.setItem).not.toHaveBeenCalled();
          done();
        });
      });
    });

    describe('when authentication type is keycloak', () => {
      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: {
            type: 'keycloak',
            authServerUrl: 'http://localhost:8080',
            realm: 'test-realm',
            clientId: 'test-client',
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
              provide: KeycloakService,
              useValue: mockKeycloakService,
            },
            {
              provide: LOGIN_SUCCESS_REDIRECT_TARGET,
              useValue: ['/clients'],
            },
          ],
        });
      });

      it('should call KeycloakService.login and return loginSuccess', (done) => {
        const action = login({});
        const outcome = loginSuccess({ authenticationType: 'keycloak' });

        actions$ = of(action);
        mockKeycloakService.login = jest.fn().mockResolvedValue(undefined);

        login$(actions$, mockAuthEnvironment, mockKeycloakService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(mockKeycloakService.login).toHaveBeenCalled();
          done();
        });
      });

      it('should return loginFailure on Keycloak login error', (done) => {
        const action = login({});
        const error = new Error('Keycloak login failed');
        const outcome = loginFailure({ error: 'Keycloak login failed' });

        actions$ = of(action);
        mockKeycloakService.login = jest.fn().mockRejectedValue(error);

        login$(actions$, mockAuthEnvironment, mockKeycloakService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });

      it('should return loginFailure if KeycloakService is not available', (done) => {
        const action = login({});
        const outcome = loginFailure({ error: 'Authentication service not available' });

        actions$ = of(action);

        login$(actions$, mockAuthEnvironment, null, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
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
              provide: KeycloakService,
              useValue: mockKeycloakService,
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

        logout$(actions$, mockAuthEnvironment, mockKeycloakService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(window.localStorage.removeItem).toHaveBeenCalledWith(API_KEY_STORAGE_KEY);
          done();
        });
      });
    });

    describe('when authentication type is keycloak', () => {
      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: {
            type: 'keycloak',
            authServerUrl: 'http://localhost:8080',
            realm: 'test-realm',
            clientId: 'test-client',
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
              provide: KeycloakService,
              useValue: mockKeycloakService,
            },
            {
              provide: LOGIN_SUCCESS_REDIRECT_TARGET,
              useValue: ['/clients'],
            },
          ],
        });
      });

      it('should call KeycloakService.logout and return logoutSuccess', (done) => {
        const action = logout({});
        const outcome = logoutSuccess();

        actions$ = of(action);
        mockKeycloakService.logout = jest.fn().mockResolvedValue(undefined);

        logout$(actions$, mockAuthEnvironment, mockKeycloakService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(mockKeycloakService.logout).toHaveBeenCalled();
          done();
        });
      });

      it('should return logoutFailure on Keycloak logout error', (done) => {
        const action = logout({});
        const error = new Error('Keycloak logout failed');
        const outcome = logoutFailure({ error: 'Keycloak logout failed' });

        actions$ = of(action);
        mockKeycloakService.logout = jest.fn().mockRejectedValue(error);

        logout$(actions$, mockAuthEnvironment, mockKeycloakService as any, null).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });

      it('should return logoutSuccess if KeycloakService is not available', (done) => {
        const action = logout({});
        const outcome = logoutSuccess();

        actions$ = of(action);

        logout$(actions$, mockAuthEnvironment, null, null).subscribe((result) => {
          expect(result).toEqual(outcome);
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
      const outcome = changePasswordSuccess();

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
              provide: KeycloakService,
              useValue: mockKeycloakService,
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

        checkAuthentication$(actions$, mockAuthEnvironment, mockKeycloakService as any).subscribe((result) => {
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

        checkAuthentication$(actions$, mockAuthEnvironment, mockKeycloakService as any).subscribe((result) => {
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

        checkAuthentication$(actions$, mockAuthEnvironment, mockKeycloakService as any).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });
    });

    describe('when authentication type is keycloak', () => {
      beforeEach(() => {
        mockAuthEnvironment = createMockIdentityAuthEnvironment({
          authentication: {
            type: 'keycloak',
            authServerUrl: 'http://localhost:8080',
            realm: 'test-realm',
            clientId: 'test-client',
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
              provide: KeycloakService,
              useValue: mockKeycloakService,
            },
            {
              provide: LOGIN_SUCCESS_REDIRECT_TARGET,
              useValue: ['/clients'],
            },
          ],
        });
      });

      it('should return checkAuthenticationSuccess with true and authenticationType if user is logged in', (done) => {
        const action = checkAuthentication();
        const outcome = checkAuthenticationSuccess({ isAuthenticated: true, authenticationType: 'keycloak' });

        actions$ = of(action);
        mockKeycloakService.isLoggedIn = jest.fn().mockReturnValue(true);

        checkAuthentication$(actions$, mockAuthEnvironment, mockKeycloakService as any).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(mockKeycloakService.isLoggedIn).toHaveBeenCalled();
          done();
        });
      });

      it('should extract admin role from realm_access.roles in token', (done) => {
        const action = checkAuthentication();

        mockKeycloakService.isLoggedIn = jest.fn().mockReturnValue(true);
        mockKeycloakService.getKeycloakInstance = jest.fn().mockReturnValue({
          tokenParsed: {
            sub: 'user-sub-123',
            email: 'admin@example.com',
            realm_access: { roles: ['admin', 'user'] },
          },
        });

        actions$ = of(action);

        checkAuthentication$(actions$, mockAuthEnvironment, mockKeycloakService as any).subscribe((result) => {
          expect(result).toEqual(
            checkAuthenticationSuccess({
              isAuthenticated: true,
              authenticationType: 'keycloak',
              user: { id: 'user-sub-123', email: 'admin@example.com', role: 'admin' },
            }),
          );
          done();
        });
      });

      it('should extract user role when realm_access has no admin', (done) => {
        const action = checkAuthentication();

        mockKeycloakService.isLoggedIn = jest.fn().mockReturnValue(true);
        mockKeycloakService.getKeycloakInstance = jest.fn().mockReturnValue({
          tokenParsed: {
            sub: 'user-sub-456',
            email: 'user@example.com',
            realm_access: { roles: ['user'] },
          },
        });

        actions$ = of(action);

        checkAuthentication$(actions$, mockAuthEnvironment, mockKeycloakService as any).subscribe((result) => {
          expect(result).toEqual(
            checkAuthenticationSuccess({
              isAuthenticated: true,
              authenticationType: 'keycloak',
              user: { id: 'user-sub-456', email: 'user@example.com', role: 'user' },
            }),
          );
          done();
        });
      });

      it('should extract admin role from resource_access client roles', (done) => {
        const action = checkAuthentication();

        mockKeycloakService.isLoggedIn = jest.fn().mockReturnValue(true);
        mockKeycloakService.getKeycloakInstance = jest.fn().mockReturnValue({
          tokenParsed: {
            sub: 'user-sub-789',
            email: 'user@example.com',
            realm_access: { roles: ['user'] },
            resource_access: {
              'test-client': { roles: ['admin'] },
            },
          },
        });

        actions$ = of(action);

        checkAuthentication$(actions$, mockAuthEnvironment, mockKeycloakService as any).subscribe((result) => {
          expect(result).toMatchObject({
            user: { id: 'user-sub-789', email: 'user@example.com', role: 'admin' },
          });
          done();
        });
      });

      it('should return checkAuthenticationSuccess with false if user is not logged in', (done) => {
        const action = checkAuthentication();
        const outcome = checkAuthenticationSuccess({ isAuthenticated: false });

        actions$ = of(action);
        mockKeycloakService.isLoggedIn = jest.fn().mockReturnValue(false);

        checkAuthentication$(actions$, mockAuthEnvironment, mockKeycloakService as any).subscribe((result) => {
          expect(result).toEqual(outcome);
          expect(mockKeycloakService.isLoggedIn).toHaveBeenCalled();
          done();
        });
      });

      it('should return checkAuthenticationFailure on error', (done) => {
        const action = checkAuthentication();
        const error = new Error('Check failed');
        const outcome = checkAuthenticationFailure({ error: 'Check failed' });

        actions$ = of(action);
        mockKeycloakService.isLoggedIn = jest.fn().mockImplementation(() => {
          throw error;
        });

        checkAuthentication$(actions$, mockAuthEnvironment, mockKeycloakService as any).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });

      it('should return checkAuthenticationSuccess with false if KeycloakService is not available', (done) => {
        const action = checkAuthentication();
        const outcome = checkAuthenticationSuccess({ isAuthenticated: false });

        actions$ = of(action);

        checkAuthentication$(actions$, mockAuthEnvironment, null).subscribe((result) => {
          expect(result).toEqual(outcome);
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

        checkAuthentication$(actions$, mockAuthEnvironment, null).subscribe((result) => {
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

        checkAuthentication$(actions$, mockAuthEnvironment, null).subscribe((result) => {
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

        checkAuthentication$(actions$, mockAuthEnvironment, null).subscribe((result) => {
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

    it('should navigate to /clients for keycloak authentication type', (done) => {
      const action = loginSuccess({ authenticationType: 'keycloak' });

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
