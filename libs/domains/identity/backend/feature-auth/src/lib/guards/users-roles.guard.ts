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

    if (getAuthenticationMethod() !== 'users') {
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

    const { user } = context.switchToHttp().getRequest();
    const roles = user?.roles;

    if (!Array.isArray(roles)) {
      return false;
    }

    return requiredRoles.some((role) => roles.includes(role));
  }
}
