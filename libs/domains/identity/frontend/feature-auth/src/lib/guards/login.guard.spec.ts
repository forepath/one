import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { convertToParamMap } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import {
  createMockIdentityAuthEnvironment,
  IDENTITY_AUTH_ENVIRONMENT,
  OidcAuthService,
  resetMtlsCredentialStateForTests,
  saveMtlsCredential,
} from '@forepath/identity/frontend';

import { loginGuard } from './login.guard';

// SAML sign-in leaves the app via `location.assign`; keep it observable instead.
jest.mock('../../../../util-auth/src/lib/saml-login.utils', () => ({
  ...jest.requireActual('../../../../util-auth/src/lib/saml-login.utils'),
  startSamlLogin: jest.fn().mockResolvedValue(undefined),
}));

const { startSamlLogin } = jest.requireMock('../../../../util-auth/src/lib/saml-login.utils') as {
  startSamlLogin: jest.Mock;
};

describe('loginGuard', () => {
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

    mockOidcAuthService = {
      isLoggedIn: jest.fn(),
      login: jest.fn().mockResolvedValue(undefined),
    };
    startSamlLogin.mockClear();

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
      mockRoute = { queryParamMap: convertToParamMap({}) } as ActivatedRouteSnapshot;
    });

    it('should redirect to dashboard if user is authenticated', () => {
      const injector = setupTestBed();
      const tree = {} as UrlTree;

      mockOidcAuthService.isLoggedIn.mockReturnValue(true);
      mockRouter.createUrlTree = jest.fn().mockReturnValue(tree);

      expect(runInInjectionContext(injector, () => loginGuard(mockRoute, mockState))).toBe(tree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/clients']);
    });

    it('should start provider sign-in and allow the login page otherwise', () => {
      const injector = setupTestBed();

      mockOidcAuthService.isLoggedIn.mockReturnValue(false);

      expect(runInInjectionContext(injector, () => loginGuard(mockRoute, mockState))).toBe(true);
      expect(mockOidcAuthService.login).toHaveBeenCalled();
    });

    it('should not redirect again after a failed sign-in', () => {
      const injector = setupTestBed();

      mockOidcAuthService.isLoggedIn.mockReturnValue(false);
      mockRoute = { queryParamMap: convertToParamMap({ sso_error: 'oidc' }) } as ActivatedRouteSnapshot;

      expect(runInInjectionContext(injector, () => loginGuard(mockRoute, mockState))).toBe(true);
      expect(mockOidcAuthService.login).not.toHaveBeenCalled();
    });
  });

  describe('when authentication type is saml', () => {
    beforeEach(() => {
      mockEnvironment = { ...mockEnvironment, authentication: { type: 'saml' } };
      mockRoute = { queryParamMap: convertToParamMap({}) } as ActivatedRouteSnapshot;
    });

    it('should redirect to dashboard with a valid session JWT', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;

      (window.localStorage.getItem as jest.Mock).mockReturnValue(`h.${btoa(JSON.stringify({ amr: ['saml'], exp }))}.s`);
      const injector = setupTestBed();
      const tree = {} as UrlTree;

      mockRouter.createUrlTree = jest.fn().mockReturnValue(tree);

      expect(runInInjectionContext(injector, () => loginGuard(mockRoute, mockState))).toBe(tree);
      expect(startSamlLogin).not.toHaveBeenCalled();
    });

    it('should start SAML sign-in without a session', () => {
      (window.localStorage.getItem as jest.Mock).mockReturnValue(null);
      const injector = setupTestBed();

      expect(runInInjectionContext(injector, () => loginGuard(mockRoute, mockState))).toBe(true);
      expect(startSamlLogin).toHaveBeenCalledWith('http://localhost:3100/api', undefined, undefined);
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

    it('should redirect to dashboard if API key exists in environment', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'api-key',
          apiKey: 'test-api-key',
        },
      });
      const mockUrlTree = {} as UrlTree;

      mockRouter.createUrlTree = jest.fn().mockReturnValue(mockUrlTree);

      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(mockUrlTree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/clients']);
    });

    it('should redirect to dashboard if API key exists in localStorage', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'api-key',
        },
      });

      (window.localStorage.getItem as jest.Mock).mockReturnValue('stored-api-key');
      const mockUrlTree = {} as UrlTree;

      mockRouter.createUrlTree = jest.fn().mockReturnValue(mockUrlTree);

      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(mockUrlTree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/clients']);
      expect(window.localStorage.getItem).toHaveBeenCalledWith('agent-controller-api-key');
    });

    it('should prefer environment API key over localStorage', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'api-key',
          apiKey: 'env-api-key',
        },
      });

      (window.localStorage.getItem as jest.Mock).mockReturnValue('stored-api-key');
      const mockUrlTree = {} as UrlTree;

      mockRouter.createUrlTree = jest.fn().mockReturnValue(mockUrlTree);

      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(mockUrlTree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/clients']);
      // Should check environment first, so localStorage might not be checked
    });

    it('should allow access if no API key exists in environment or localStorage', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'api-key',
        },
      });

      (window.localStorage.getItem as jest.Mock).mockReturnValue(null);

      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
      expect(window.localStorage.getItem).toHaveBeenCalledWith('agent-controller-api-key');
    });

    it('should allow access if API key is empty string in environment and localStorage', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'api-key',
          apiKey: '',
        },
      });

      (window.localStorage.getItem as jest.Mock).mockReturnValue('');

      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
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

    it('should redirect to dashboard if valid JWT exists in localStorage', () => {
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
      const mockUrlTree = {} as UrlTree;

      mockRouter.createUrlTree = jest.fn().mockReturnValue(mockUrlTree);

      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(mockUrlTree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/clients']);
    });

    it('should allow access if no JWT exists in localStorage', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'users',
        },
      });

      (window.localStorage.getItem as jest.Mock).mockReturnValue(null);

      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
    });

    it('should allow access if JWT is expired', () => {
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

      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
    });

    it('should clear PAT JWT and allow login access', () => {
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

      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('agent-controller-users-jwt');
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
    });
  });

  describe('when authentication type is unknown', () => {
    it('should allow access to login', () => {
      const injector = setupTestBed({
        authentication: {
          type: 'unknown' as never,
        } as IdentityAuthEnvironment['authentication'],
      });
      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
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

    it('redirects signed-in users (valid client certificate) to /clients', async () => {
      const tree = {} as UrlTree;

      mockRouter.createUrlTree.mockReturnValue(tree);
      await storeCertificate();

      const injector = setupTestBed({ authentication: { type: 'mtls' } });
      const result = await runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(tree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/clients']);
      expect(window.localStorage.getItem).not.toHaveBeenCalled();
    });

    it('shows the login page when no valid client certificate is stored', async () => {
      const tree = {} as UrlTree;

      mockRouter.createUrlTree.mockReturnValue(tree);
      await storeCertificate(Date.now() - 1000);

      const injector = setupTestBed({ authentication: { type: 'mtls' } });
      const result = await runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
    });
  });
});
