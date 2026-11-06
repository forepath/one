import {
  getAuthenticationMethod,
  IS_PUBLIC_KEY,
  type OidcAccessTokenClaims,
  OidcTokenVerifier,
} from '@forepath/identity/backend';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ExternalIdentityService, parseEmailVerifiedClaim } from '../services/external-identity.service';

import type { AuthenticatedUsersRequestUser } from './users-auth.guard';

/** Authentication method reference for interactive OIDC sessions. */
export const OIDC_SESSION_AMR = 'oidc';

/**
 * Maps the verified OIDC identity (`request.oidcClaims`, set by `OidcAuthGuard`) to the local `users` row and
 * replaces `request.user` with `{ id, email, roles: [localRole], amr: ['oidc'] }`.
 * Roles always come from the local user (first user of a tenant is admin), never from IdP role claims.
 * Locked users and users of another tenant are rejected with 401.
 */
@Injectable()
export class ExternalIdentityAuthGuard implements CanActivate {
  constructor(
    private readonly externalIdentityService: ExternalIdentityService,
    private readonly verifier: OidcTokenVerifier,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (getAuthenticationMethod() !== 'oidc') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      patAuthenticated?: boolean;
      oidcClaims?: OidcAccessTokenClaims;
      user?: unknown;
    }>();

    // PAT / app access JWTs already resolved a local user; ops routes (Bull Board, metrics) carry no claims.
    if (request.patAuthenticated || !request.oidcClaims) {
      return true;
    }

    const claims = request.oidcClaims;
    const user = await this.externalIdentityService.resolveUser({
      provider: 'oidc',
      subject: claims.sub,
      email: this.verifier.getEmail(claims),
      emailVerified: parseEmailVerifiedClaim(claims.email_verified),
    });

    request.user = {
      id: user.id,
      email: user.email,
      roles: [user.role],
      amr: [OIDC_SESSION_AMR],
      exp: typeof claims.exp === 'number' ? claims.exp : undefined,
    } satisfies AuthenticatedUsersRequestUser;

    return true;
  }
}
