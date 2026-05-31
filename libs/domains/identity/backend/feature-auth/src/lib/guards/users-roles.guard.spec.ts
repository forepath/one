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
});
