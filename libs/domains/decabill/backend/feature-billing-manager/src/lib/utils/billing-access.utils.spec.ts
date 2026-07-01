import { UserRole } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import {
  ensureAdmin,
  getAuthenticatedUserFromRequest,
  getUserFromRequest,
  type RequestWithUser,
} from './billing-access.utils';

describe('billing-access.utils', () => {
  it('getUserFromRequest returns api key auth without user id', () => {
    const req = { apiKeyAuthenticated: true } as RequestWithUser;

    expect(getUserFromRequest(req)).toEqual({ isApiKeyAuth: true });
  });

  it('getUserFromRequest returns empty user when not authenticated', () => {
    const req = {} as RequestWithUser;

    expect(getUserFromRequest(req)).toEqual({ isApiKeyAuth: false });
  });

  it('getUserFromRequest maps admin role', () => {
    const req = {
      user: { id: 'admin-1', roles: [UserRole.ADMIN] },
    } as RequestWithUser;

    expect(getUserFromRequest(req)).toEqual({
      userId: 'admin-1',
      userRole: UserRole.ADMIN,
      isApiKeyAuth: false,
    });
  });

  it('getUserFromRequest maps admin string role', () => {
    const req = {
      user: { id: 'admin-1', roles: ['admin'] },
    } as RequestWithUser;

    expect(getUserFromRequest(req).userRole).toBe(UserRole.ADMIN);
  });

  it('getAuthenticatedUserFromRequest throws when user id missing', () => {
    expect(() => getAuthenticatedUserFromRequest({} as RequestWithUser)).toThrow(BadRequestException);
  });

  it('ensureAdmin allows api key auth', () => {
    expect(() => ensureAdmin({ isApiKeyAuth: true })).not.toThrow();
  });

  it('ensureAdmin rejects non-admin users', () => {
    expect(() => ensureAdmin({ userId: 'u1', userRole: UserRole.USER, isApiKeyAuth: false })).toThrow(
      ForbiddenException,
    );
  });
});
