import { getMissingPatScopes, IS_PUBLIC_KEY, usesLocalUserAccounts } from '@forepath/identity/backend';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REQUIRE_PASSWORD_SESSION_KEY, REQUIRE_SCOPES_KEY } from '../constants/pat.constants';

import type { AuthenticatedUsersRequestUser } from './users-auth.guard';

/**
 * Enforces PAT scopes (fail-closed for `amr: pat`) and interactive-session-only routes.
 * Scope levels are hierarchical per resource (`admin` ⊇ `write` ⊇ `read`); see {@link getMissingPatScopes}.
 * Interactive console sessions skip scope checks. Must run after auth guards set `request.user`.
 */
@Injectable()
export class PatScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (!usesLocalUserAccounts()) {
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

    const missing = getMissingPatScopes(user.scopes ?? [], requiredScopes);

    if (missing.length > 0) {
      throw new ForbiddenException(`Insufficient token scope. Missing: ${missing.join(', ')}`);
    }

    return true;
  }
}
