import { IS_PUBLIC_KEY } from '@forepath/identity/backend';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REQUIRE_PASSWORD_SESSION_KEY, REQUIRE_SCOPES_KEY } from '../constants/pat.constants';

import { PatScopesGuard } from './pat-scopes.guard';

describe('PatScopesGuard', () => {
  let guard: PatScopesGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let originalAuthMethod: string | undefined;
  const createContext = (user?: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as never;

  beforeEach(() => {
    originalAuthMethod = process.env.AUTHENTICATION_METHOD;
    process.env.AUTHENTICATION_METHOD = 'users';
    reflector = { getAllAndOverride: jest.fn() };
    guard = new PatScopesGuard(reflector as unknown as Reflector);
  });

  afterEach(() => {
    if (originalAuthMethod !== undefined) {
      process.env.AUTHENTICATION_METHOD = originalAuthMethod;
    } else {
      delete process.env.AUTHENTICATION_METHOD;
    }
  });

  it('allows password sessions without scopes', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) {
        return false;
      }

      if (key === REQUIRE_PASSWORD_SESSION_KEY) {
        return false;
      }

      if (key === REQUIRE_SCOPES_KEY) {
        return undefined;
      }

      return undefined;
    });

    expect(guard.canActivate(createContext({ id: 'u1', amr: ['pwd'] }))).toBe(true);
  });

  it('fail-closes PAT requests without @RequireScopes', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === REQUIRE_SCOPES_KEY) {
        return undefined;
      }

      return false;
    });

    expect(() => guard.canActivate(createContext({ id: 'u1', amr: ['pat'], scopes: ['usage:write'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('allows PAT when required scopes are present', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === REQUIRE_SCOPES_KEY) {
        return ['usage:write'];
      }

      return false;
    });

    expect(
      guard.canActivate(createContext({ id: 'u1', amr: ['pat'], scopes: ['usage:write', 'webhooks:admin'] })),
    ).toBe(true);
  });

  it('rejects PAT missing a required scope', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === REQUIRE_SCOPES_KEY) {
        return ['webhooks:admin'];
      }

      return false;
    });

    expect(() => guard.canActivate(createContext({ id: 'u1', amr: ['pat'], scopes: ['usage:write'] }))).toThrow(
      /Insufficient token scope/,
    );
  });

  it('rejects PAT on @RequirePasswordSession routes', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === REQUIRE_PASSWORD_SESSION_KEY) {
        return true;
      }

      return false;
    });

    expect(() => guard.canActivate(createContext({ id: 'u1', amr: ['pat'], scopes: ['users:admin'] }))).toThrow(
      /cannot access this endpoint/,
    );
  });

  it('rejects unauthenticated requests on non-public routes', () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    expect(() => guard.canActivate(createContext(undefined))).toThrow(UnauthorizedException);
  });

  it('enforces scopes under keycloak mode', () => {
    process.env.AUTHENTICATION_METHOD = 'keycloak';
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === REQUIRE_SCOPES_KEY) {
        return ['usage:write'];
      }

      return false;
    });

    expect(guard.canActivate(createContext({ id: 'u1', amr: ['pat'], scopes: ['usage:write'] }))).toBe(true);
  });

  it('no-ops under api-key mode', () => {
    process.env.AUTHENTICATION_METHOD = 'api-key';
    reflector.getAllAndOverride.mockReturnValue(false);

    expect(guard.canActivate(createContext({ id: 'u1', amr: ['pat'] }))).toBe(true);
  });
});
