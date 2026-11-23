import { assertPatScopes, isAdministrativeRole, resolveUserRoleFromRoles, UserRole } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';

export interface RequestWithUser extends Request {
  user?: {
    id: string;
    email?: string;
    roles?: string[];
    username?: string;
    amr?: string[];
    scopes?: string[];
  };
  apiKeyAuthenticated?: boolean;
}

export interface UserInfoFromRequest {
  userId?: string;
  userRole?: UserRole;
  isApiKeyAuth: boolean;
  amr?: string[];
  scopes?: string[];
}

export function getUserFromRequest(req: RequestWithUser): UserInfoFromRequest {
  const isApiKeyAuth = !!req.apiKeyAuthenticated;

  if (isApiKeyAuth) {
    return { isApiKeyAuth: true };
  }

  const user = req.user;

  if (!user?.id) {
    return { isApiKeyAuth: false };
  }

  const userRole: UserRole = resolveUserRoleFromRoles(user.roles);

  return {
    userId: user.id,
    userRole,
    isApiKeyAuth: false,
    amr: user.amr,
    scopes: user.scopes,
  };
}

export function getAuthenticatedUserFromRequest(req: RequestWithUser): UserInfoFromRequest {
  const userInfo = getUserFromRequest(req);

  if (!userInfo.userId) {
    throw new BadRequestException('User not authenticated');
  }

  return userInfo;
}

/** Administration access: admins and managers (or the static credential). */
export function ensureAdmin(userInfo: UserInfoFromRequest): void {
  if (userInfo.isApiKeyAuth) {
    return;
  }

  if (!isAdministrativeRole(userInfo.userRole)) {
    throw new ForbiddenException('Admin access required');
  }
}

/**
 * Gate the "acting on someone else's record" branch of owner-or-admin routes.
 * Requires the admin or manager role and, for personal access tokens, the resource's `:admin` scope
 * (the route-level scope only covers the caller's own records).
 */
export function ensureAdminForForeignRecord(userInfo: UserInfoFromRequest, adminScope: string): void {
  ensureAdmin(userInfo);
  assertPatScopes(userInfo, adminScope);
}
