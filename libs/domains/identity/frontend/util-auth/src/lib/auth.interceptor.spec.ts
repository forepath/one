import { HttpRequest, HttpResponse } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KeycloakService } from 'keycloak-angular';
import { of } from 'rxjs';

import { IDENTITY_AUTH_ENVIRONMENT, IdentityAuthEnvironment } from './auth-environment';
import { createMockIdentityAuthEnvironment } from './auth-environment.test-fixtures';
import { authInterceptor } from './auth.interceptor';

// Mock KeycloakService to avoid ES module import issues in Jest
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
}));

describe('authInterceptor', () => {
  const mockNext = jest.fn((req: HttpRequest<unknown>) => {
    return of(new HttpResponse({ body: null, status: 200, url: req.url, headers: req.headers }));
  });
  let mockAuthEnv: IdentityAuthEnvironment;
  let mockKeycloakService: jest.Mocked<Partial<KeycloakService>>;
  const setupTestBed = (envOverrides?: Partial<IdentityAuthEnvironment>, keycloakServiceOverride?: any): Injector => {
    TestBed.resetTestingModule();
    const providers: any[] = [
      {
        provide: IDENTITY_AUTH_ENVIRONMENT,
        useValue: { ...mockAuthEnv, ...envOverrides },
      },
    ];

    if (keycloakServiceOverride !== null) {
      providers.push({
        provide: KeycloakService,
        useValue: keycloakServiceOverride !== undefined ? keycloakServiceOverride : mockKeycloakService,
      });
    }

    TestBed.configureTestingModule({
      providers,
    });

    return TestBed.inject(Injector);
  };

  beforeEach(() => {
    mockAuthEnv = createMockIdentityAuthEnvironment({
      authentication: {
        type: 'api-key',
        apiKey: 'test-api-key',
      },
    });

    mockKeycloakService = {
      getToken: jest.fn(),
    };

    Storage.prototype.getItem = jest.fn().mockReturnValue(null);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(authInterceptor).toBeDefined();
  });

  describe('when request URL does not match API URL', () => {
    it('should pass through requests without modification', (done) => {
      const injector = setupTestBed();
      const req = new HttpRequest('GET', 'http://other-domain.com/api/data');
      const result = runInInjectionContext(injector, () => authInterceptor(req, mockNext));

      result.subscribe((response) => {
        expect(response).toBeInstanceOf(HttpResponse);
        expect(mockNext).toHaveBeenCalledWith(req);
        done();
      });
    });
  });

  describe('when authentication type is api-key', () => {
    it('should add Authorization header with API key', (done) => {
      const injector = setupTestBed();
      const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');
      const result = runInInjectionContext(injector, () => authInterceptor(req, mockNext));

      result.subscribe((response) => {
        expect(response).toBeInstanceOf(HttpResponse);
        const httpResponse = response as HttpResponse<unknown>;

        expect(httpResponse.headers.get('Authorization')).toBe('Bearer test-api-key');
        expect(mockNext).toHaveBeenCalled();
        const interceptedReq = mockNext.mock.calls[0][0];

        expect(interceptedReq.headers.get('Authorization')).toBe('Bearer test-api-key');
        done();
      });
    });

    it('should not add Authorization header if API key is missing', (done) => {
      const injector = setupTestBed({
        authentication: { type: 'api-key', apiKey: undefined },
      });

      Storage.prototype.getItem = jest.fn().mockReturnValue(null);
      const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');
      const result = runInInjectionContext(injector, () => authInterceptor(req, mockNext));

      result.subscribe((response) => {
        expect(response).toBeInstanceOf(HttpResponse);
        const httpResponse = response as HttpResponse<unknown>;

        expect(httpResponse.headers.has('Authorization')).toBe(false);
        done();
      });
    });

    it('should use API key from localStorage when environment API key is missing', (done) => {
      const localStorageApiKey = 'localStorage-api-key-123';

      Storage.prototype.getItem = jest.fn().mockReturnValue(localStorageApiKey);
      const injector = setupTestBed({
        authentication: { type: 'api-key', apiKey: undefined },
      });
      const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');
      const result = runInInjectionContext(injector, () => authInterceptor(req, mockNext));

      result.subscribe((response) => {
        expect(Storage.prototype.getItem).toHaveBeenCalledWith('agent-controller-api-key');
        expect(response).toBeInstanceOf(HttpResponse);
        const httpResponse = response as HttpResponse<unknown>;

        expect(httpResponse.headers.get('Authorization')).toBe(`Bearer ${localStorageApiKey}`);
        expect(mockNext).toHaveBeenCalled();
        const interceptedReq = mockNext.mock.calls[0][0];

        expect(interceptedReq.headers.get('Authorization')).toBe(`Bearer ${localStorageApiKey}`);
        done();
      });
    });

    it('should prefer environment API key over localStorage API key', (done) => {
      const environmentApiKey = 'environment-api-key';
      const localStorageApiKey = 'localStorage-api-key-123';

      Storage.prototype.getItem = jest.fn().mockReturnValue(localStorageApiKey);
      const injector = setupTestBed({
        authentication: { type: 'api-key', apiKey: environmentApiKey },
      });
      const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');
      const result = runInInjectionContext(injector, () => authInterceptor(req, mockNext));

      result.subscribe((response) => {
        expect(response).toBeInstanceOf(HttpResponse);
        const httpResponse = response as HttpResponse<unknown>;

        expect(httpResponse.headers.get('Authorization')).toBe(`Bearer ${environmentApiKey}`);
        expect(Storage.prototype.getItem).not.toHaveBeenCalled();
        done();
      });
    });
  });

  describe('when authentication type is keycloak', () => {
    it('should add Authorization header with Keycloak token', (done) => {
      const keycloakService = {
        getToken: jest.fn().mockResolvedValue('keycloak-token-123'),
      };
      const injector = setupTestBed(
        {
          authentication: { type: 'keycloak', authServerUrl: '', realm: '', clientId: '' },
        },
        keycloakService,
      );
      const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');
      const result = runInInjectionContext(injector, () => authInterceptor(req, mockNext));

      result.subscribe((response) => {
        expect(keycloakService.getToken).toHaveBeenCalled();
        expect(response).toBeInstanceOf(HttpResponse);
        const httpResponse = response as HttpResponse<unknown>;

        expect(httpResponse.headers.get('Authorization')).toBe('Bearer keycloak-token-123');
        done();
      });
    });

    it('should not add Authorization header if token is missing', (done) => {
      const keycloakService = {
        getToken: jest.fn().mockResolvedValue(null),
      };
      const injector = setupTestBed(
        {
          authentication: { type: 'keycloak', authServerUrl: '', realm: '', clientId: '' },
        },
        keycloakService,
      );
      const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');
      const result = runInInjectionContext(injector, () => authInterceptor(req, mockNext));

      result.subscribe((response) => {
        expect(response).toBeInstanceOf(HttpResponse);
        const httpResponse = response as HttpResponse<unknown>;

        expect(httpResponse.headers.has('Authorization')).toBe(false);
        done();
      });
    });

    it('should handle KeycloakService errors gracefully', (done) => {
      const keycloakService = {
        getToken: jest.fn().mockRejectedValue(new Error('Token retrieval failed')),
      };
      const injector = setupTestBed(
        {
          authentication: { type: 'keycloak', authServerUrl: '', realm: '', clientId: '' },
        },
        keycloakService,
      );
      const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');
      const result = runInInjectionContext(injector, () => authInterceptor(req, mockNext));

      result.subscribe({
        next: () => {
          done();
        },
        error: (error) => {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe('Token retrieval failed');
          done();
        },
      });
    });

    it('should not add Authorization header if KeycloakService is not available', (done) => {
      const injector = setupTestBed(
        {
          authentication: { type: 'keycloak', authServerUrl: '', realm: '', clientId: '' },
        },
        null,
      );
      const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');
      const result = runInInjectionContext(injector, () => authInterceptor(req, mockNext));

      result.subscribe((response) => {
        expect(response).toBeInstanceOf(HttpResponse);
        const httpResponse = response as HttpResponse<unknown>;

        expect(httpResponse.headers.has('Authorization')).toBe(false);
        done();
      });
    });
  });

  describe('when authentication type is users', () => {
    it('should add Authorization header with JWT from localStorage', (done) => {
      const jwt = 'users-jwt-token-123';

      Storage.prototype.getItem = jest.fn().mockReturnValue(jwt);
      const injector = setupTestBed({
        authentication: { type: 'users' },
      });
      const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');
      const result = runInInjectionContext(injector, () => authInterceptor(req, mockNext));

      result.subscribe((response) => {
        expect(Storage.prototype.getItem).toHaveBeenCalledWith('agent-controller-users-jwt');
        expect(response).toBeInstanceOf(HttpResponse);
        const httpResponse = response as HttpResponse<unknown>;

        expect(httpResponse.headers.get('Authorization')).toBe(`Bearer ${jwt}`);
        done();
      });
    });

    it('should not add Authorization header if JWT is missing', (done) => {
      Storage.prototype.getItem = jest.fn().mockReturnValue(null);
      const injector = setupTestBed({
        authentication: { type: 'users' },
      });
      const req = new HttpRequest('GET', 'http://localhost:3100/api/clients');
      const result = runInInjectionContext(injector, () => authInterceptor(req, mockNext));

      result.subscribe((response) => {
        expect(response).toBeInstanceOf(HttpResponse);
        const httpResponse = response as HttpResponse<unknown>;

        expect(httpResponse.headers.has('Authorization')).toBe(false);
        done();
      });
    });
  });
});
