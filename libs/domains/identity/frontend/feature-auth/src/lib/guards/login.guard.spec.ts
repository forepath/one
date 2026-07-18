import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import { createMockIdentityAuthEnvironment, IDENTITY_AUTH_ENVIRONMENT } from '@forepath/identity/frontend';
import { KeycloakService } from 'keycloak-angular';

import { loginGuard } from './login.guard';

// Mock keycloak-angular to avoid ES module import issues with keycloak-js in Jest.
// createAuthGuard is called at module load time by keycloak.guard.ts (re-exported via barrel).
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
  createAuthGuard: jest.fn().mockReturnValue(() => Promise.resolve(true)),
}));

describe('loginGuard', () => {
  let mockRouter: jest.Mocked<Router>;
  let mockRoute: ActivatedRouteSnapshot;
  let mockState: RouterStateSnapshot;
  let mockEnvironment: IdentityAuthEnvironment;
  let mockKeycloakService: jest.Mocked<Partial<KeycloakService>>;
  const setupTestBed = (
    environmentOverrides?: Partial<IdentityAuthEnvironment>,
    keycloakServiceOverride?: Partial<KeycloakService> | null,
  ): Injector => {
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
          provide: KeycloakService,
          useValue: keycloakServiceOverride ?? mockKeycloakService,
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

    mockKeycloakService = {
      isLoggedIn: jest.fn(),
      login: jest.fn(),
    };

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    (window.localStorage.getItem as jest.Mock).mockClear();
  });

  describe('when authentication type is keycloak', () => {
    beforeEach(() => {
      mockEnvironment = {
        ...mockEnvironment,
        authentication: {
          type: 'keycloak',
          authServerUrl: 'http://localhost:8080',
          realm: 'test-realm',
          clientId: 'test-client',
        },
      };
    });

    it('should redirect to dashboard if user is authenticated', () => {
      const mockIsLoggedIn = jest.fn().mockReturnValue(true);
      const injector = setupTestBed(undefined, {
        isLoggedIn: mockIsLoggedIn,
      });
      const mockUrlTree = {} as UrlTree;

      mockRouter.createUrlTree = jest.fn().mockReturnValue(mockUrlTree);

      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(mockUrlTree);
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/clients']);
      expect(mockIsLoggedIn).toHaveBeenCalled();
    });

    it('should call login and allow access if user is not authenticated', () => {
      const mockLogin = jest.fn();
      const mockIsLoggedIn = jest.fn().mockReturnValue(false);
      const injector = setupTestBed(undefined, {
        isLoggedIn: mockIsLoggedIn,
        login: mockLogin,
      });
      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockIsLoggedIn).toHaveBeenCalled();
      expect(mockLogin).toHaveBeenCalled();
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
    });

    it('should allow access if KeycloakService is not available', () => {
      const injector = setupTestBed(undefined, null);
      const result = runInInjectionContext(injector, () => loginGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
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
});
