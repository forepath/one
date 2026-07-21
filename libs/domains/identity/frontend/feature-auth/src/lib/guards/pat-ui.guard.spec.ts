import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

// eslint-disable-next-line @nx/enforce-module-boundaries
import type { IdentityAuthEnvironment } from '../../../../util-auth/src';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { IDENTITY_AUTH_ENVIRONMENT } from '../../../../util-auth/src';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createMockIdentityAuthEnvironment } from '../../../../util-auth/src/lib/auth-environment.test-fixtures';

import { patUiGuard } from './pat-ui.guard';

jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
  createAuthGuard: jest.fn().mockReturnValue(() => Promise.resolve(true)),
}));

describe('patUiGuard', () => {
  let mockRouter: jest.Mocked<Router>;
  let mockRoute: ActivatedRouteSnapshot;
  let mockState: RouterStateSnapshot;
  const setup = (authentication: IdentityAuthEnvironment['authentication']): Injector => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: IDENTITY_AUTH_ENVIRONMENT,
          useValue: createMockIdentityAuthEnvironment({ authentication }),
        },
        { provide: Router, useValue: mockRouter },
      ],
    });

    return TestBed.inject(Injector);
  };

  beforeEach(() => {
    mockRouter = { createUrlTree: jest.fn() } as unknown as jest.Mocked<Router>;
    mockRoute = {} as ActivatedRouteSnapshot;
    mockState = {} as RouterStateSnapshot;
  });

  it('allows users mode', () => {
    const injector = setup({ type: 'users' });

    expect(runInInjectionContext(injector, () => patUiGuard(mockRoute, mockState))).toBe(true);
  });

  it('allows keycloak mode', () => {
    const injector = setup({
      type: 'keycloak',
      authServerUrl: 'http://localhost:8080',
      realm: 'test',
      clientId: 'test',
    });

    expect(runInInjectionContext(injector, () => patUiGuard(mockRoute, mockState))).toBe(true);
  });

  it('redirects home for api-key mode', () => {
    const injector = setup({ type: 'api-key' });
    const tree = {} as UrlTree;

    mockRouter.createUrlTree.mockReturnValue(tree);

    expect(runInInjectionContext(injector, () => patUiGuard(mockRoute, mockState))).toBe(tree);
    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/']);
  });
});
