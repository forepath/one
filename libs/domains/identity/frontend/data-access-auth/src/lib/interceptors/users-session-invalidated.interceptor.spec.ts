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

import { usersSessionInvalidatedInterceptor } from './users-session-invalidated.interceptor';

describe('usersSessionInvalidatedInterceptor', () => {
  let mockNext: jest.Mock;
  let storeDispatch: jest.Mock;
  let removeItemSpy: jest.SpyInstance;
  const setupInjector = (env: IdentityAuthEnvironment, store?: { dispatch: jest.Mock }): Injector => {
    TestBed.resetTestingModule();
    const providers: unknown[] = [{ provide: IDENTITY_AUTH_ENVIRONMENT, useValue: env }];

    if (store) {
      providers.push({ provide: Store, useValue: store });
    } else {
      providers.push({ provide: Router, useValue: { navigate: jest.fn().mockResolvedValue(true) } });
    }

    TestBed.configureTestingModule({ providers });

    return TestBed.inject(Injector);
  };

  beforeEach(() => {
    storeDispatch = jest.fn();
    mockNext = jest.fn();
    removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem');
    jest.clearAllMocks();
  });

  afterEach(() => {
    removeItemSpy.mockRestore();
  });

  it('dispatches logout and clears JWT storage on locked-account 401 for users mode', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'users' },
    });
    const injector = setupInjector(env, { dispatch: storeDispatch });

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
        done();
      },
    });
  });

  it('does not logout on 401 with change-password message', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'users' },
    });
    const injector = setupInjector(env, { dispatch: storeDispatch });

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
        done();
      },
    });
  });

  it('no-ops for api-key authentication type', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'api-key', apiKey: 'k' },
    });
    const injector = setupInjector(env, { dispatch: storeDispatch });

    mockNext.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            error: { message: 'This account is locked. Please contact an administrator.' },
          }),
      ),
    );

    const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');

    runInInjectionContext(injector, () => usersSessionInvalidatedInterceptor(req, mockNext)).subscribe({
      error: () => {
        expect(removeItemSpy).not.toHaveBeenCalled();
        expect(storeDispatch).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('dispatches logout on locked-account 401 for keycloak mode without clearing users JWT storage', (done) => {
    const env: IdentityAuthEnvironment = createMockIdentityAuthEnvironment({
      authentication: { type: 'keycloak' },
    });
    const injector = setupInjector(env, { dispatch: storeDispatch });

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
        done();
      },
    });
  });
});
