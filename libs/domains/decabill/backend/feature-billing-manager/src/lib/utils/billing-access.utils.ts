import { UserRole } from '@forepath/identity/backend';
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

  let userRole: UserRole = UserRole.USER;

  if (user.roles?.includes('admin') || user.roles?.includes(UserRole.ADMIN)) {
    userRole = UserRole.ADMIN;
  }

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

export function ensureAdmin(userInfo: UserInfoFromRequest): void {
  if (userInfo.isApiKeyAuth) {
    return;
  }

  if (userInfo.userRole !== UserRole.ADMIN) {
    throw new ForbiddenException('Admin access required');
  }
}
