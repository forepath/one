import { recordSharedCounter } from '@forepath/shared/backend/util-otel/metrics';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { getAuthenticationMethod } from '../authentication-method';
import { isBullBoardRequestPath } from '../bull-board-request-path';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { getHttpRequestPath } from '../http-request-path.util';
import { isOtelMetricsRequestPath } from '../otel-metrics-request-path';

import { type OidcAccessTokenClaims, OidcTokenVerifier } from './oidc-token-verifier.service';

/** Request fields set by {@link OidcAuthGuard}. */
export interface OidcAuthenticatedRequest {
  headers: { authorization?: string };
  user?: unknown;
  /** Verified OIDC access token claims (interactive OIDC sessions and service tokens). */
  oidcClaims?: OidcAccessTokenClaims;
  patAuthenticated?: boolean;
  apiKeyAuthenticated?: boolean;
}

/**
 * Authenticates `Authorization: Bearer <access token>` against the configured OIDC provider
 * (`AUTHENTICATION_METHOD=oidc`). Replaces the former nest-keycloak-connect Auth/Resource/Role guards.
 *
 * Skips public routes, Bull Board / OTEL metrics (own HTTP Basic auth) and requests already authenticated by an
 * app-signed PAT / app access token (`PatBearerAuthGuard`). Sets `request.user` and `request.oidcClaims`
 * to the verified claims; the host app maps them to a local user (`ExternalIdentityAuthGuard`) when it keeps one.
 */
@Injectable()
export class OidcAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: OidcTokenVerifier,
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

    const path = getHttpRequestPath(context);

    if (isBullBoardRequestPath(path) || isOtelMetricsRequestPath(path)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<OidcAuthenticatedRequest>();

    if (request.patAuthenticated || request.apiKeyAuthenticated) {
      return true;
    }

    const [scheme, token, ...rest] = request.headers.authorization?.split(' ') ?? [];

    if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
      recordSharedCounter('auth.requests.total', { outcome: 'unauthorized' });
      throw new UnauthorizedException('Missing or invalid authorization token');
    }

    try {
      const claims = await this.verifier.verifyAccessToken(token);

      request.oidcClaims = claims;
      request.user = claims;

      return true;
    } catch (error) {
      recordSharedCounter('auth.requests.total', { outcome: 'unauthorized' });
      throw error instanceof UnauthorizedException ? error : new UnauthorizedException('Invalid or expired token');
    }
  }
}
