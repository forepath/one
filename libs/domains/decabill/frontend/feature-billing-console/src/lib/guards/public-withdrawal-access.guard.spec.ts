import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import {
  API_KEY_STORAGE_KEY,
  type AuthenticationConfig,
  createMockIdentityAuthEnvironment,
  IDENTITY_AUTH_ENVIRONMENT,
  OidcAuthService,
  resetMtlsCredentialStateForTests,
  saveMtlsCredential,
} from '@forepath/identity/frontend';

import { publicWithdrawalAccessGuard } from './public-withdrawal-access.guard';

describe('publicWithdrawalAccessGuard', () => {
  const subscriptionsUrl = {} as UrlTree;
  let router: { createUrlTree: jest.Mock };
  const run = (authentication: AuthenticationConfig) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: IDENTITY_AUTH_ENVIRONMENT, useValue: createMockIdentityAuthEnvironment({ authentication }) },
        { provide: Router, useValue: router },
        { provide: OidcAuthService, useValue: { isLoggedIn: () => false } },
      ],
    });

    return runInInjectionContext(TestBed.inject(Injector), () =>
      publicWithdrawalAccessGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
  };

  beforeEach(() => {
    router = { createUrlTree: jest.fn().mockReturnValue(subscriptionsUrl) };
    localStorage.clear();
    resetMtlsCredentialStateForTests();
  });

  it('lets anonymous api-key visitors through and redirects signed-in ones', () => {
    expect(run({ type: 'api-key' })).toBe(true);

    localStorage.setItem(API_KEY_STORAGE_KEY, 'stored-key');

    expect(run({ type: 'api-key' })).toBe(subscriptionsUrl);
  });

  it('lets mtls visitors without a stored certificate through and redirects signed-in ones', async () => {
    await expect(run({ type: 'mtls' })).resolves.toBe(true);

    await saveMtlsCredential({
      privateKey: { type: 'private', usages: ['sign'] } as unknown as CryptoKey,
      certificateChain: ['AAAA'],
      algorithm: 'ES256',
      notBefore: Date.now() - 1000,
      notAfter: Date.now() + 60_000,
    });

    await expect(run({ type: 'mtls' })).resolves.toBe(subscriptionsUrl);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/subscriptions']);
  });
});
