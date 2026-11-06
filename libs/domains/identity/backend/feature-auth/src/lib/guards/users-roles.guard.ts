import {
  getAuthenticationMethod,
  getHttpRequestPath,
  isBullBoardRequestPath,
  IS_PUBLIC_KEY,
  USERS_ROLES_KEY,
  UserRole,
} from '@forepath/identity/backend';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class UsersRolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    if (getAuthenticationMethod() === 'api-key') {
      return true;
    }

    if (isBullBoardRequestPath(getHttpRequestPath(context))) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(USERS_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { roles?: unknown };
    }>();
    const roles = request.user?.roles;

    // Roles always come from the local users table: users/saml JWTs, PAT/app JWTs and OIDC sessions
    // (ExternalIdentityAuthGuard replaces the token claims with the synced user before this guard runs).
    // Without a resolved role array the route is denied (fail-closed).
    if (!Array.isArray(roles)) {
      return false;
    }

    return requiredRoles.some((role) => roles.includes(role));
  }
}
