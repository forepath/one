import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

// eslint-disable-next-line @nx/enforce-module-boundaries
import type { IdentityAuthEnvironment } from '../../../../util-auth/src';
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  IDENTITY_AUTH_ENVIRONMENT,
  OidcAuthService,
  resetMtlsCredentialStateForTests,
  saveMtlsCredential,
  startSamlLogin,
} from '../../../../util-auth/src';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createMockIdentityAuthEnvironment } from '../../../../util-auth/src/lib/auth-environment.test-fixtures';

import { authGuard } from './auth.guard';

// SAML sign-in leaves the app via `location.assign`; keep it observable instead.
jest.mock('../../../../util-auth/src', () => ({
  ...jest.requireActual('../../../../util-auth/src'),
  startSamlLogin: jest.fn().mockResolvedValue(undefined),
}));

describe('authGuard', () => {
  let mockRouter: jest.Mocked<Router>;
  let mockRoute: ActivatedRouteSnapshot;
  let mockState: RouterStateSnapshot;
  let mockEnvironment: IdentityAuthEnvironment;
  let mockOidcAuthService: { isLoggedIn: jest.Mock; login: jest.Mock };
  const setupTestBed = (environmentOverrides?: Partial<IdentityAuthEnvironment>): Injector => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: IDENTITY_AUTH_ENVIRONMENT,
          useValue: { ...mockEnvironment, ...environmentOverrides },
        },
        {
          provide: Router,
          useValue: mockRouter,
        },
        {
          provide: OidcAuthService,
          useValue: mockOidcAuthService,
        },
      ],
    });

    return TestBed.inject(Injector);
  };

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

    mockRouter = {
      createUrlTree: jest.fn(),
    } as unknown as jest.Mocked<Router>;

    mockRoute = {} as ActivatedRouteSnapshot;
    mockState = {} as RouterStateSnapshot;

    mockEnvironment = createMockIdentityAuthEnvironment();

    mockOidcAuthService = { isLoggedIn: jest.fn(), login: jest.fn().mockResolvedValue(undefined) };

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    (window.localStorage.getItem as jest.Mock).mockClear();
  });

  describe('when authentication type is oidc', () => {
    beforeEach(() => {
      mockEnvironment = {
        ...mockEnvironment,
        authentication: { type: 'oidc', issuer: 'https://idp.example.com', clientId: 'console' },
      };
      mockState = { url: '/clients/1' } as RouterStateSnapshot;
    });

    it('should allow access with an OIDC session', () => {
      const injector = setupTestBed();

      mockOidcAuthService.isLoggedIn.mockReturnValue(true);

      expect(runInInjectionContext(injector, () => authGuard(mockRoute, mockState))).toBe(true);
      expect(mockOidcAuthService.login).not.toHaveBeenCalled();
    });

    it('should redirect to the identity provider and return to the requested URL', () => {
      const injector = setupTestBed();

      mockOidcAuthService.isLoggedIn.mockReturnValue(false);

      expect(runInInjectionContext(injector, () => authGuard(mockRoute, mockState))).toBe(false);
      expect(mockOidcAuthService.login).toHaveBeenCalledWith('/clients/1');
    });
  });

  describe('when authentication type is saml', () => {
    beforeEach(() => {
      mockEnvironment = { ...mockEnvironment, authentication: { type: 'saml' } };
      mockState = { url: '/clients/1' } as RouterStateSnapshot;
      (startSamlLogin as jest.Mock).mockClear();
    });

    it('should allow access with a valid SAML session JWT', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const jwt = `h.${btoa(JSON.stringify({ sub: 'u', amr: ['saml'], exp }))}.s`;

      (window.localStorage.getItem as jest.Mock).mockReturnValue(jwt);
      const injector = setupTestBed();

      expect(runInInjectionContext(injector, () => authGuard(mockRoute, mockState))).toBe(true);
      expect(startSamlLogin).not.toHaveBeenCalled();
    });

    it('should start SAML sign-in at the API without a session', () => {
      (window.localStorage.getItem as jest.Mock).mockReturnValue(null);
      const injector = setupTestBed();

      expect(runInInjectionContext(injector, () => authGuard(mockRoute, mockState))).toBe(false);
      expect(startSamlLogin).toHaveBeenCalledWith('http://localhost:3100/api', '/clients/1', undefined);
    });

    it('should clear PAT JWTs and start sign-in', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;

      (window.localStorage.getItem as jest.Mock).mockReturnValue(`h.${btoa(JSON.stringify({ amr: ['pat'], exp }))}.s`);
      const injector = setupTestBed();

      expect(runInInjectionContext(injector, () => authGuard(mockRoute, mockState))).toBe(false);
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('agent-controller-users-jwt');
      expect(startSamlLogin).toHaveBeenCalled();
    });
  });

  describe('when authentication type is api-key', () => {
    beforeEach(() => {
      mockEnvironment = {
        ...mockEnvironment,
        authentication: {
          type: 'api-key',
        },
      };
    });

    it('should allow access if API key exists in environment', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'api-key',
          apiKey: 'test-api-key',
        },
      });
      const result = runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
    });

    it('should allow access if API key exists in localStorage', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'api-key',
        },
      });

      (window.localStorage.getItem as jest.Mock).mockReturnValue('stored-api-key');

      const result = runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(window.localStorage.getItem).toHaveBeenCalledWith('agent-controller-api-key');
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
    });

    it('should prefer environment API key over localStorage', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'api-key',
          apiKey: 'env-api-key',
        },
      });

      (window.localStorage.getItem as jest.Mock).mockReturnValue('stored-api-key');

      const result = runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
    });

    it('should redirect to login if no API key exists in environment or localStorage', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'api-key',
        },
      });

      (window.localStorage.getItem as jest.Mock).mockReturnValue(null);
      const mockUrlTree = {} as UrlTree;

      mockRouter.createUrlTree = jest.fn().mockReturnValue(mockUrlTree);

      const result = runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(mockUrlTree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/login']);
      expect(window.localStorage.getItem).toHaveBeenCalledWith('agent-controller-api-key');
    });

    it('should redirect to login if API key is empty string in environment and localStorage', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'api-key',
          apiKey: '',
        },
      });

      (window.localStorage.getItem as jest.Mock).mockReturnValue('');
      const mockUrlTree = {} as UrlTree;

      mockRouter.createUrlTree = jest.fn().mockReturnValue(mockUrlTree);

      const result = runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(mockUrlTree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/login']);
    });
  });

  describe('when authentication type is users', () => {
    beforeEach(() => {
      mockEnvironment = {
        ...mockEnvironment,
        authentication: {
          type: 'users',
        },
      };
    });

    it('should allow access if valid JWT exists in localStorage', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'users',
        },
      });
      const exp = Math.floor((Date.now() + 3600000) / 1000);
      const payload = btoa(JSON.stringify({ sub: 'user-1', email: 'test@example.com', exp }));
      const jwt = `header.${payload}.signature`;

      (window.localStorage.getItem as jest.Mock).mockImplementation((key: string) =>
        key === 'agent-controller-users-jwt' ? jwt : null,
      );

      const result = runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
    });

    it('should redirect to login if no JWT exists in localStorage', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'users',
        },
      });

      (window.localStorage.getItem as jest.Mock).mockReturnValue(null);
      const mockUrlTree = {} as UrlTree;

      mockRouter.createUrlTree = jest.fn().mockReturnValue(mockUrlTree);

      const result = runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(mockUrlTree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/login']);
    });

    it('should redirect to login if JWT is expired', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'users',
        },
      });
      const exp = Math.floor((Date.now() - 3600000) / 1000);
      const payload = btoa(JSON.stringify({ sub: 'user-1', email: 'test@example.com', exp }));
      const jwt = `header.${payload}.signature`;

      (window.localStorage.getItem as jest.Mock).mockImplementation((key: string) =>
        key === 'agent-controller-users-jwt' ? jwt : null,
      );
      const mockUrlTree = {} as UrlTree;

      mockRouter.createUrlTree = jest.fn().mockReturnValue(mockUrlTree);

      const result = runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(mockUrlTree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/login']);
    });

    it('should clear PAT JWT and redirect to login when amr includes pat', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'users',
        },
      });
      const exp = Math.floor((Date.now() + 3600000) / 1000);
      const payload = btoa(JSON.stringify({ sub: 'user-1', email: 'test@example.com', exp, amr: ['pat'] }));
      const jwt = `header.${payload}.signature`;

      (window.localStorage.getItem as jest.Mock).mockImplementation((key: string) =>
        key === 'agent-controller-users-jwt' ? jwt : null,
      );
      const mockUrlTree = {} as UrlTree;

      mockRouter.createUrlTree = jest.fn().mockReturnValue(mockUrlTree);

      const result = runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(mockUrlTree);
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('agent-controller-users-jwt');
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/login']);
    });
  });

  describe('when authentication type is unknown', () => {
    it('should redirect to login', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'unknown' as never,
        } as IdentityAuthEnvironment['authentication'],
      });
      const mockUrlTree = {} as UrlTree;

      mockRouter.createUrlTree = jest.fn().mockReturnValue(mockUrlTree);

      const result = runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(mockUrlTree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/login']);
    });
  });

  describe('when authentication type is mtls', () => {
    beforeEach(() => {
      resetMtlsCredentialStateForTests();
    });

    const storeCertificate = (notAfter = Date.now() + 60_000) =>
      saveMtlsCredential({
        privateKey: { type: 'private', usages: ['sign'] } as unknown as CryptoKey,
        certificateChain: ['AAAA'],
        algorithm: 'ES256',
        notBefore: Date.now() - 1000,
        notAfter,
      });

    it('allows access when a valid client certificate is stored', async () => {
      const tree = {} as UrlTree;

      mockRouter.createUrlTree.mockReturnValue(tree);
      await storeCertificate();

      const injector = setupTestBed({ authentication: { type: 'mtls' } });
      const result = await runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
      expect(window.localStorage.getItem).not.toHaveBeenCalled();
    });

    it('redirects to /login when no valid client certificate is stored', async () => {
      const tree = {} as UrlTree;

      mockRouter.createUrlTree.mockReturnValue(tree);
      await storeCertificate(Date.now() - 1000);

      const injector = setupTestBed({ authentication: { type: 'mtls' } });
      const result = await runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(tree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/login']);
    });
  });
});
