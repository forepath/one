import { UserRole } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';
import { Request } from 'express';

export interface RequestWithUser extends Request {
  user?: { id: string; email?: string; roles?: string[]; username?: string };
  apiKeyAuthenticated?: boolean;
}

export interface UserInfoFromRequest {
  userId?: string;
  userRole?: UserRole;
  isApiKeyAuth: boolean;
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

  let userRole: UserRole = UserRole.USER;

  if (user.roles?.includes('admin') || user.roles?.includes(UserRole.ADMIN)) {
    userRole = UserRole.ADMIN;
  }

  return {
    userId: user.id,
    userRole,
    isApiKeyAuth: false,
  };
}

export function ensureAdmin(userInfo: UserInfoFromRequest): void {
  if (userInfo.isApiKeyAuth) {
    return;
  }

  if (userInfo.userRole !== UserRole.ADMIN) {
    throw new ForbiddenException('Admin access required');
  }
}
