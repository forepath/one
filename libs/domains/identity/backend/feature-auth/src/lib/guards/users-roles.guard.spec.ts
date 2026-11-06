import { IS_PUBLIC_KEY, USERS_ROLES_KEY, UserRole } from '@forepath/identity/backend';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UsersRolesGuard } from './users-roles.guard';

describe('UsersRolesGuard', () => {
  let guard: UsersRolesGuard;
  let getAllAndOverride: jest.Mock;
  let originalAuthMethod: string | undefined;
  const createExecutionContext = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as ExecutionContext;

  beforeEach(() => {
    originalAuthMethod = process.env.AUTHENTICATION_METHOD;
    process.env.AUTHENTICATION_METHOD = 'users';
    getAllAndOverride = jest.fn((key: string) => {
      if (key === USERS_ROLES_KEY) {
        return [UserRole.ADMIN];
      }

      if (key === IS_PUBLIC_KEY) {
        return false;
      }

      return false;
    });
    guard = new UsersRolesGuard({ getAllAndOverride } as unknown as Reflector);
  });

  afterEach(() => {
    if (originalAuthMethod !== undefined) {
      process.env.AUTHENTICATION_METHOD = originalAuthMethod;
    } else {
      delete process.env.AUTHENTICATION_METHOD;
    }
  });

  it('allows Bull Board paths without user roles', () => {
    expect(
      guard.canActivate(
        createExecutionContext({
          originalUrl: '/admin/queues',
          headers: { authorization: 'Basic YWRtaW46YnVsbG1x' },
        }),
      ),
    ).toBe(true);
  });

  it.each(['api-key', 'mtls'])('skips role checks for the %s static credential (full access)', (method) => {
    process.env.AUTHENTICATION_METHOD = method;

    expect(guard.canActivate(createExecutionContext({ originalUrl: '/api/admin', headers: {} }))).toBe(true);
  });

  it('enforces roles for users mode without a resolved role', () => {
    expect(guard.canActivate(createExecutionContext({ originalUrl: '/api/admin', headers: {} }))).toBe(false);
  });

  it('under oidc denies unsynced IdP claims (IdP role claims are never trusted)', () => {
    process.env.AUTHENTICATION_METHOD = 'oidc';

    expect(
      guard.canActivate(
        createExecutionContext({
          user: { sub: 'idp-sub', realm_access: { roles: ['admin'] }, roles: undefined },
        }),
      ),
    ).toBe(false);
  });

  it('under oidc enforces roles of the synced local user', () => {
    process.env.AUTHENTICATION_METHOD = 'oidc';

    expect(
      guard.canActivate(createExecutionContext({ user: { id: 'u1', roles: [UserRole.USER], amr: ['oidc'] } })),
    ).toBe(false);
    expect(
      guard.canActivate(createExecutionContext({ user: { id: 'u1', roles: [UserRole.ADMIN], amr: ['oidc'] } })),
    ).toBe(true);
  });

  it('under saml enforces roles of the session JWT user', () => {
    process.env.AUTHENTICATION_METHOD = 'saml';

    expect(
      guard.canActivate(createExecutionContext({ user: { id: 'u1', roles: [UserRole.USER], amr: ['saml'] } })),
    ).toBe(false);
  });

  it('under oidc enforces roles for PAT JWTs', () => {
    process.env.AUTHENTICATION_METHOD = 'oidc';

    expect(
      guard.canActivate(
        createExecutionContext({
          patAuthenticated: true,
          user: { id: 'u1', roles: [UserRole.USER] },
        }),
      ),
    ).toBe(false);

    expect(
      guard.canActivate(
        createExecutionContext({
          patAuthenticated: true,
          user: { id: 'u1', roles: [UserRole.ADMIN] },
        }),
      ),
    ).toBe(true);
  });
});
