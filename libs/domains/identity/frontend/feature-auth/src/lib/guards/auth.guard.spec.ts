import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

// eslint-disable-next-line @nx/enforce-module-boundaries
import type { IdentityAuthEnvironment } from '../../../../util-auth/src';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { IDENTITY_AUTH_ENVIRONMENT, isAuthenticated } from '../../../../util-auth/src';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createMockIdentityAuthEnvironment } from '../../../../util-auth/src/lib/auth-environment.test-fixtures';

import { authGuard } from './auth.guard';

// Mock keycloak-angular to avoid ES module import issues with keycloak-js in Jest.
// createAuthGuard is called at module load time by keycloak.guard.ts (re-exported via barrel).
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
  createAuthGuard: jest.fn().mockReturnValue(() => Promise.resolve(true)),
}));

// Mock isAuthenticated guard from util-auth barrel
jest.mock('../../../../util-auth/src', () => ({
  ...jest.requireActual('../../../../util-auth/src'),
  isAuthenticated: jest.fn(),
}));

describe('authGuard', () => {
  let mockRouter: jest.Mocked<Router>;
  let mockRoute: ActivatedRouteSnapshot;
  let mockState: RouterStateSnapshot;
  let mockEnvironment: IdentityAuthEnvironment;
  let mockIsAuthenticated: jest.MockedFunction<typeof isAuthenticated>;
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

    mockIsAuthenticated = isAuthenticated as jest.MockedFunction<typeof isAuthenticated>;

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

    it('should delegate to isAuthenticated guard', () => {
      const injector = setupTestBed();

      mockIsAuthenticated.mockReturnValue(true);

      const result = runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(mockIsAuthenticated).toHaveBeenCalledWith(mockRoute, mockState);
      expect(result).toBe(true);
    });

    it('should return the result from isAuthenticated guard', () => {
      const injector = setupTestBed();
      const mockUrlTree = {} as UrlTree;

      mockIsAuthenticated.mockReturnValue(mockUrlTree);

      const result = runInInjectionContext(injector, () => authGuard(mockRoute, mockState));

      expect(result).toBe(mockUrlTree);
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
});
