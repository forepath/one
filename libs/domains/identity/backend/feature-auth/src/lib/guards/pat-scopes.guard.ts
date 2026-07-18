import { getAuthenticationMethod, IS_PUBLIC_KEY } from '@forepath/identity/backend';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REQUIRE_PASSWORD_SESSION_KEY, REQUIRE_SCOPES_KEY } from '../constants/pat.constants';

import type { AuthenticatedUsersRequestUser } from './users-auth.guard';

/**
 * Enforces PAT scopes (fail-closed for `amr: pat`) and interactive-session-only routes.
 * Interactive console sessions skip scope checks. Must run after auth guards set `request.user`.
 */
@Injectable()
export class PatScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const authMethod = getAuthenticationMethod();

    if (authMethod !== 'users' && authMethod !== 'keycloak') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUsersRequestUser }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required.');
    }

    const amr = user.amr ?? ['pwd'];
    const isPat = amr.includes('pat');
    const requireInteractiveSession = this.reflector.getAllAndOverride<boolean>(REQUIRE_PASSWORD_SESSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requireInteractiveSession && isPat) {
      throw new ForbiddenException('Personal access tokens cannot access this endpoint.');
    }

    if (!isPat) {
      return true;
    }

    const requiredScopes = this.reflector.getAllAndOverride<string[]>(REQUIRE_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredScopes || requiredScopes.length === 0) {
      throw new ForbiddenException('Personal access token is not permitted for this endpoint.');
    }

    const tokenScopes = new Set(user.scopes ?? []);
    const missing = requiredScopes.filter((scope) => !tokenScopes.has(scope));

    if (missing.length > 0) {
      throw new ForbiddenException(`Insufficient token scope. Missing: ${missing.join(', ')}`);
    }

    return true;
  }
}
