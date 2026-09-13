import { HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  createMockIdentityAuthEnvironment,
  IDENTITY_AUTH_ENVIRONMENT,
  IdentityAuthEnvironment,
  USERS_JWT_STORAGE_KEY,
} from '@forepath/identity/frontend';
import { Store } from '@ngrx/store';
import { throwError } from 'rxjs';

import { logout } from '../state/authentication/authentication.actions';

import {
  resetUsersSessionInvalidationStateForTests,
  usersSessionInvalidatedInterceptor,
} from './users-session-invalidated.interceptor';

const API_KEY_STORAGE_KEY = 'agent-controller-api-key';

describe('usersSessionInvalidatedInterceptor', () => {
  let mockNext: jest.Mock;
  let storeDispatch: jest.Mock;
  let routerNavigate: jest.Mock;
  let removeItemSpy: jest.SpyInstance;
  const setupInjector = (
    env: IdentityAuthEnvironment,
    options: { withStore?: boolean } = { withStore: true },
  ): Injector => {
    TestBed.resetTestingModule();
    const providers: unknown[] = [
      { provide: IDENTITY_AUTH_ENVIRONMENT, useValue: env },
      { provide: Router, useValue: { navigate: routerNavigate } },
    ];

    if (options.withStore !== false) {
      providers.push({ provide: Store, useValue: { dispatch: storeDispatch } });
    }

    TestBed.configureTestingModule({ providers });

    return TestBed.inject(Injector);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    storeDispatch = jest.fn();
    routerNavigate = jest.fn().mockResolvedValue(true);
    mockNext = jest.fn();
    removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem');
    resetUsersSessionInvalidationStateForTests();
  });

  afterEach(() => {
    removeItemSpy.mockRestore();
    resetUsersSessionInvalidationStateForTests();
  });

  it('dispatches logout, clears JWT, and navigates on locked-account 401 for users mode', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'users' },
    });
    const injector = setupInjector(env);

    mockNext.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            url: 'http://localhost:3100/api/clients',
            error: {
              message: 'This account is locked. Please contact an administrator.',
              statusCode: 401,
            },
          }),
      ),
    );

    const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');

    runInInjectionContext(injector, () => usersSessionInvalidatedInterceptor(req, mockNext)).subscribe({
      error: () => {
        expect(removeItemSpy).toHaveBeenCalledWith(USERS_JWT_STORAGE_KEY);
        expect(storeDispatch).toHaveBeenCalledWith(logout({}));
        expect(routerNavigate).toHaveBeenCalledWith(['/login']);
        done();
      },
    });
  });

  it('dispatches logout and navigates on generic Unauthorized 401 for users mode', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'users' },
    });
    const injector = setupInjector(env);

    mockNext.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            url: 'http://localhost:3100/api/clients',
            error: { message: 'Unauthorized', statusCode: 401 },
          }),
      ),
    );

    const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');

    runInInjectionContext(injector, () => usersSessionInvalidatedInterceptor(req, mockNext)).subscribe({
      error: () => {
        expect(removeItemSpy).toHaveBeenCalledWith(USERS_JWT_STORAGE_KEY);
        expect(storeDispatch).toHaveBeenCalledWith(logout({}));
        expect(routerNavigate).toHaveBeenCalledWith(['/login']);
        done();
      },
    });
  });

  it('dispatches logout and navigates on empty-body 401 for users mode', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'users' },
    });
    const injector = setupInjector(env);

    mockNext.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            url: 'http://localhost:3100/api/clients',
            error: null,
          }),
      ),
    );

    const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');

    runInInjectionContext(injector, () => usersSessionInvalidatedInterceptor(req, mockNext)).subscribe({
      error: () => {
        expect(removeItemSpy).toHaveBeenCalledWith(USERS_JWT_STORAGE_KEY);
        expect(storeDispatch).toHaveBeenCalledWith(logout({}));
        expect(routerNavigate).toHaveBeenCalledWith(['/login']);
        done();
      },
    });
  });

  it('does not logout on 401 with change-password message', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'users' },
    });
    const injector = setupInjector(env);

    mockNext.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            url: 'http://localhost:3100/api/auth/change-password',
            error: { message: 'Current password is incorrect', statusCode: 401 },
          }),
      ),
    );

    const req = new HttpRequest('POST', 'http://localhost:3100/api/auth/change-password', {});

    runInInjectionContext(injector, () => usersSessionInvalidatedInterceptor(req, mockNext)).subscribe({
      error: () => {
        expect(removeItemSpy).not.toHaveBeenCalled();
        expect(storeDispatch).not.toHaveBeenCalled();
        expect(routerNavigate).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('does not logout on login 401 with Invalid email or password', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'users' },
    });
    const injector = setupInjector(env);

    mockNext.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            url: 'http://localhost:3100/api/auth/login',
            error: { message: 'Invalid email or password', statusCode: 401 },
          }),
      ),
    );

    const req = new HttpRequest('POST', 'http://localhost:3100/api/auth/login', {});

    runInInjectionContext(injector, () => usersSessionInvalidatedInterceptor(req, mockNext)).subscribe({
      error: () => {
        expect(removeItemSpy).not.toHaveBeenCalled();
        expect(storeDispatch).not.toHaveBeenCalled();
        expect(routerNavigate).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('clears API key storage, dispatches logout, and navigates on Invalid API key 401', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'api-key', apiKey: 'k' },
    });
    const injector = setupInjector(env);

    mockNext.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            url: 'http://localhost:3100/api/clients',
            error: { message: 'Invalid API key', statusCode: 401 },
          }),
      ),
    );

    const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');

    runInInjectionContext(injector, () => usersSessionInvalidatedInterceptor(req, mockNext)).subscribe({
      error: () => {
        expect(removeItemSpy).toHaveBeenCalledWith(API_KEY_STORAGE_KEY);
        expect(removeItemSpy).not.toHaveBeenCalledWith(USERS_JWT_STORAGE_KEY);
        expect(storeDispatch).toHaveBeenCalledWith(logout({}));
        expect(routerNavigate).toHaveBeenCalledWith(['/login']);
        done();
      },
    });
  });

  it('dispatches logout on Missing authorization header 401 for api-key mode', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'api-key', apiKey: 'k' },
    });
    const injector = setupInjector(env);

    mockNext.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            url: 'http://localhost:3100/api/clients',
            error: { message: 'Missing authorization header', statusCode: 401 },
          }),
      ),
    );

    const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');

    runInInjectionContext(injector, () => usersSessionInvalidatedInterceptor(req, mockNext)).subscribe({
      error: () => {
        expect(removeItemSpy).toHaveBeenCalledWith(API_KEY_STORAGE_KEY);
        expect(storeDispatch).toHaveBeenCalledWith(logout({}));
        expect(routerNavigate).toHaveBeenCalledWith(['/login']);
        done();
      },
    });
  });

  it('dispatches logout on locked-account 401 for keycloak mode without clearing users JWT or navigating', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'keycloak' },
    });
    const injector = setupInjector(env);

    mockNext.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            url: 'http://localhost:3100/api/clients',
            error: {
              message: 'This account is locked. Please contact an administrator.',
              statusCode: 401,
            },
          }),
      ),
    );

    const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');

    runInInjectionContext(injector, () => usersSessionInvalidatedInterceptor(req, mockNext)).subscribe({
      error: () => {
        expect(removeItemSpy).not.toHaveBeenCalledWith(USERS_JWT_STORAGE_KEY);
        expect(storeDispatch).toHaveBeenCalledWith(logout({}));
        expect(routerNavigate).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('does not logout on 404', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'users' },
    });
    const injector = setupInjector(env);

    mockNext.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 404,
            url: 'http://localhost:3100/api/clients',
            error: { message: 'Not Found', statusCode: 404 },
          }),
      ),
    );

    const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');

    runInInjectionContext(injector, () => usersSessionInvalidatedInterceptor(req, mockNext)).subscribe({
      error: () => {
        expect(removeItemSpy).not.toHaveBeenCalled();
        expect(storeDispatch).not.toHaveBeenCalled();
        expect(routerNavigate).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('does not logout on 500', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'users' },
    });
    const injector = setupInjector(env);

    mockNext.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 500,
            url: 'http://localhost:3100/api/clients',
            error: { message: 'Internal Server Error', statusCode: 500 },
          }),
      ),
    );

    const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');

    runInInjectionContext(injector, () => usersSessionInvalidatedInterceptor(req, mockNext)).subscribe({
      error: () => {
        expect(removeItemSpy).not.toHaveBeenCalled();
        expect(storeDispatch).not.toHaveBeenCalled();
        expect(routerNavigate).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('navigates to login without store when router is available', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'users' },
    });
    const injector = setupInjector(env, { withStore: false });

    mockNext.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            url: 'http://localhost:3100/api/clients',
            error: { message: 'Unauthorized', statusCode: 401 },
          }),
      ),
    );

    const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');

    runInInjectionContext(injector, () => usersSessionInvalidatedInterceptor(req, mockNext)).subscribe({
      error: () => {
        expect(removeItemSpy).toHaveBeenCalledWith(USERS_JWT_STORAGE_KEY);
        expect(storeDispatch).not.toHaveBeenCalled();
        expect(routerNavigate).toHaveBeenCalledWith(['/login']);
        done();
      },
    });
  });
});
