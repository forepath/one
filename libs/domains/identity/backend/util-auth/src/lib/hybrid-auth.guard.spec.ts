import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { AuthGuard, ResourceGuard, RoleGuard } from 'nest-keycloak-connect';

import { getAuthenticationMethod, getHybridAuthGuards, HybridAuthGuard } from './hybrid-auth.guard';

describe('HybridAuthGuard', () => {
  let guard: HybridAuthGuard;
  let reflector: Reflector;
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let originalStaticApiKey: string | undefined;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new HybridAuthGuard(reflector);

    // Save original STATIC_API_KEY
    originalStaticApiKey = process.env.STATIC_API_KEY;

    // Mock ExecutionContext (handler/class required for Reflector metadata on @Public routes)
    mockExecutionContext = {
      switchToHttp: jest.fn(),
      getClass: jest.fn().mockReturnValue({}),
      getHandler: jest.fn().mockReturnValue({}),
      getArgs: jest.fn(),
      getArgByIndex: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
      getType: jest.fn(),
    } as unknown as jest.Mocked<ExecutionContext>;
  });

  afterEach(() => {
    // Restore original STATIC_API_KEY
    if (originalStaticApiKey !== undefined) {
      process.env.STATIC_API_KEY = originalStaticApiKey;
    } else {
      delete process.env.STATIC_API_KEY;
    }

    jest.clearAllMocks();
  });

  describe('when AUTHENTICATION_METHOD is api-key but STATIC_API_KEY is not set', () => {
    beforeEach(() => {
      process.env.AUTHENTICATION_METHOD = 'api-key';
      delete process.env.STATIC_API_KEY;
    });

    it('should throw UnauthorizedException', () => {
      const mockRequest = {
        url: '/api/clients',
        headers: {},
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      expect(() => guard.canActivate(mockExecutionContext)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(mockExecutionContext)).toThrow('STATIC_API_KEY is not set');
    });
  });

  describe('when STATIC_API_KEY is not set (keycloak mode)', () => {
    beforeEach(() => {
      delete process.env.STATIC_API_KEY;
      delete process.env.AUTHENTICATION_METHOD;
    });

    it('should allow request to proceed to Keycloak guards', () => {
      const mockRequest = {
        url: '/api/some-other-endpoint',
        headers: {},
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      const result = guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should allow health check endpoint without authentication', () => {
      const mockRequest = {
        url: '/api/health',
        headers: {},
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      const result = guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });
  });

  describe('when STATIC_API_KEY is set', () => {
    const testApiKey = 'test-api-key-123';
    let getAllAndOverrideSpy: jest.SpyInstance;

    beforeEach(() => {
      process.env.STATIC_API_KEY = testApiKey;
      getAllAndOverrideSpy = jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    });

    afterEach(() => {
      getAllAndOverrideSpy.mockRestore();
    });

    it('should allow health check endpoint without authentication', () => {
      const mockRequest = {
        url: '/api/health',
        headers: {},
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      const result = guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should allow Bull Board paths without API key (HTTP Basic on board routes)', () => {
      const mockRequest = {
        originalUrl: '/admin/queues/api/queues/agent-controller/jobs/clean',
        url: '/admin/queues/api/queues/agent-controller/jobs/clean',
        headers: { authorization: 'Basic YWRtaW46YnVsbG1x' },
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      expect(guard.canActivate(mockExecutionContext)).toBe(true);
    });

    it('should throw UnauthorizedException when authorization header is missing', () => {
      const mockRequest = {
        headers: {},
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      expect(() => guard.canActivate(mockExecutionContext)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(mockExecutionContext)).toThrow('Missing authorization header');
    });

    it('should throw UnauthorizedException when authorization header format is invalid (no space)', () => {
      const mockRequest = {
        headers: {
          authorization: 'InvalidFormat',
        },
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      expect(() => guard.canActivate(mockExecutionContext)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(mockExecutionContext)).toThrow('Invalid authorization header format');
    });

    it('should throw UnauthorizedException when authorization header format is invalid (too many parts)', () => {
      const mockRequest = {
        headers: {
          authorization: 'Bearer key extra',
        },
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      expect(() => guard.canActivate(mockExecutionContext)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(mockExecutionContext)).toThrow('Invalid authorization header format');
    });

    it('should throw UnauthorizedException when API key does not match', () => {
      const mockRequest = {
        headers: {
          authorization: 'Bearer wrong-key',
        },
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      expect(() => guard.canActivate(mockExecutionContext)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(mockExecutionContext)).toThrow('Invalid API key');
    });

    it('should throw UnauthorizedException when scheme is not Bearer or ApiKey', () => {
      const mockRequest = {
        headers: {
          authorization: 'Basic test-api-key-123',
        },
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      expect(() => guard.canActivate(mockExecutionContext)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(mockExecutionContext)).toThrow('Invalid API key');
    });

    it('should authenticate successfully with Bearer scheme and correct API key', () => {
      const mockRequest = {
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        user: undefined,
        apiKeyAuthenticated: undefined,
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      const result = guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.user).toEqual({
        id: 'api-key-user',
        username: 'api-key',
        roles: ['admin', 'user'],
      });
      expect(mockRequest.apiKeyAuthenticated).toBe(true);
    });

    it('should authenticate successfully with ApiKey scheme and correct API key', () => {
      const mockRequest = {
        headers: {
          authorization: `ApiKey ${testApiKey}`,
        },
        user: undefined,
        apiKeyAuthenticated: undefined,
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      const result = guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.user).toEqual({
        id: 'api-key-user',
        username: 'api-key',
        roles: ['admin', 'user'],
      });
      expect(mockRequest.apiKeyAuthenticated).toBe(true);
    });

    it('should handle case-sensitive API key matching', () => {
      const mockRequest = {
        headers: {
          authorization: `Bearer ${testApiKey.toUpperCase()}`,
        },
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      expect(() => guard.canActivate(mockExecutionContext)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(mockExecutionContext)).toThrow('Invalid API key');
    });

    it('should handle empty API key in header', () => {
      const mockRequest = {
        headers: {
          authorization: 'Bearer ',
        },
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });

      expect(() => guard.canActivate(mockExecutionContext)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(mockExecutionContext)).toThrow('Invalid API key');
    });

    it('should allow unauthenticated access when handler is marked public (IS_PUBLIC_KEY)', () => {
      process.env.AUTHENTICATION_METHOD = 'api-key';
      const mockRequest = {
        url: '/api/public/service-plan-offerings',
        headers: {},
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });
      getAllAndOverrideSpy.mockReturnValue(true);

      const result = guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(getAllAndOverrideSpy).toHaveBeenCalled();
    });

    it('should still require API key when not public', () => {
      process.env.AUTHENTICATION_METHOD = 'api-key';
      const mockRequest = {
        url: '/api/service-plans',
        headers: {},
      };

      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      });
      getAllAndOverrideSpy.mockReturnValue(false);

      expect(() => guard.canActivate(mockExecutionContext)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(mockExecutionContext)).toThrow('Missing authorization header');
    });
  });
});

describe('getAuthenticationMethod', () => {
  let originalStaticApiKey: string | undefined;
  let originalAuthMethod: string | undefined;

  beforeEach(() => {
    originalStaticApiKey = process.env.STATIC_API_KEY;
    originalAuthMethod = process.env.AUTHENTICATION_METHOD;
  });

  afterEach(() => {
    if (originalStaticApiKey !== undefined) process.env.STATIC_API_KEY = originalStaticApiKey;
    else delete process.env.STATIC_API_KEY;

    if (originalAuthMethod !== undefined) process.env.AUTHENTICATION_METHOD = originalAuthMethod;
    else delete process.env.AUTHENTICATION_METHOD;
  });

  it('should return api-key when AUTHENTICATION_METHOD=api-key', () => {
    process.env.AUTHENTICATION_METHOD = 'api-key';
    expect(getAuthenticationMethod()).toBe('api-key');
  });

  it('should return keycloak when AUTHENTICATION_METHOD=keycloak', () => {
    process.env.AUTHENTICATION_METHOD = 'keycloak';
    expect(getAuthenticationMethod()).toBe('keycloak');
  });

  it('should return users when AUTHENTICATION_METHOD=users', () => {
    process.env.AUTHENTICATION_METHOD = 'users';
    expect(getAuthenticationMethod()).toBe('users');
  });

  it('should return api-key when AUTHENTICATION_METHOD not set but STATIC_API_KEY set (backward compat)', () => {
    delete process.env.AUTHENTICATION_METHOD;
    process.env.STATIC_API_KEY = 'key';
    expect(getAuthenticationMethod()).toBe('api-key');
  });

  it('should return keycloak when neither AUTHENTICATION_METHOD nor STATIC_API_KEY set (backward compat)', () => {
    delete process.env.AUTHENTICATION_METHOD;
    delete process.env.STATIC_API_KEY;
    expect(getAuthenticationMethod()).toBe('keycloak');
  });
});

describe('getHybridAuthGuards', () => {
  let originalStaticApiKey: string | undefined;
  let originalAuthMethod: string | undefined;

  beforeEach(() => {
    originalStaticApiKey = process.env.STATIC_API_KEY;
    originalAuthMethod = process.env.AUTHENTICATION_METHOD;
  });

  afterEach(() => {
    if (originalStaticApiKey !== undefined) process.env.STATIC_API_KEY = originalStaticApiKey;
    else delete process.env.STATIC_API_KEY;

    if (originalAuthMethod !== undefined) process.env.AUTHENTICATION_METHOD = originalAuthMethod;
    else delete process.env.AUTHENTICATION_METHOD;
  });

  describe('when AUTHENTICATION_METHOD is keycloak (STATIC_API_KEY not set)', () => {
    beforeEach(() => {
      delete process.env.STATIC_API_KEY;
      delete process.env.AUTHENTICATION_METHOD;
    });

    it('should return HybridAuthGuard and all Keycloak guards', () => {
      const guards = getHybridAuthGuards();

      expect(guards).toHaveLength(4);
      expect(guards[0]).toEqual({
        provide: APP_GUARD,
        useClass: HybridAuthGuard,
      });
      expect(guards[1]).toEqual({
        provide: APP_GUARD,
        useClass: AuthGuard,
      });
      expect(guards[2]).toEqual({
        provide: APP_GUARD,
        useClass: ResourceGuard,
      });
      expect(guards[3]).toEqual({
        provide: APP_GUARD,
        useClass: RoleGuard,
      });
    });
  });

  describe('when AUTHENTICATION_METHOD is api-key (STATIC_API_KEY set)', () => {
    beforeEach(() => {
      process.env.STATIC_API_KEY = 'test-api-key';
      delete process.env.AUTHENTICATION_METHOD;
    });

    it('should return only HybridAuthGuard (no Keycloak guards)', () => {
      const guards = getHybridAuthGuards();

      expect(guards).toHaveLength(1);
      expect(guards[0]).toEqual({
        provide: APP_GUARD,
        useClass: HybridAuthGuard,
      });
    });
  });

  describe('when AUTHENTICATION_METHOD is users', () => {
    beforeEach(() => {
      process.env.AUTHENTICATION_METHOD = 'users';
      delete process.env.STATIC_API_KEY;
    });

    it('should return only HybridAuthGuard (users auth uses JWT guard from UsersAuthModule)', () => {
      const guards = getHybridAuthGuards();

      expect(guards).toHaveLength(1);
      expect(guards[0]).toEqual({
        provide: APP_GUARD,
        useClass: HybridAuthGuard,
      });
    });
  });

  describe('when STATIC_API_KEY is empty string and AUTHENTICATION_METHOD not set', () => {
    beforeEach(() => {
      process.env.STATIC_API_KEY = '';
      delete process.env.AUTHENTICATION_METHOD;
    });

    it('should return HybridAuthGuard and all Keycloak guards (empty string is falsy)', () => {
      const guards = getHybridAuthGuards();

      expect(guards).toHaveLength(4);
      expect(guards[0]).toEqual({
        provide: APP_GUARD,
        useClass: HybridAuthGuard,
      });
      expect(guards[1]).toEqual({
        provide: APP_GUARD,
        useClass: AuthGuard,
      });
    });
  });
});
