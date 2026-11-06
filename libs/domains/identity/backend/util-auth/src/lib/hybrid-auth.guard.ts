import { recordSharedCounter } from '@forepath/shared/backend/util-otel/metrics';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';

import { getAuthenticationMethod } from './authentication-method';
import { isBullBoardRequestPath } from './bull-board-request-path';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { OidcAuthGuard } from './oidc/oidc-auth.guard';
import { isOtelMetricsRequestPath } from './otel-metrics-request-path';
import { secretsEqual } from './secret-compare';

/**
 * Guard that validates static API key authentication.
 * When AUTHENTICATION_METHOD is 'api-key' (or STATIC_API_KEY is set for backward compatibility),
 * only API key authentication is used (no IdP fallback, no anonymous access).
 * When 'users', 'oidc' or 'saml', this guard allows requests to proceed to the respective auth guards.
 */
@Injectable()
export class HybridAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const rawUrl: unknown = request.originalUrl ?? request.url;
    const url = typeof rawUrl === 'string' ? rawUrl : '';
    const path = url.split('?')[0]?.replace(/\/+$/, '') ?? '';

    // Allow health check endpoint without authentication
    if (path === '/api/health' || path === '/health') {
      return true;
    }

    // Bull Board / OTEL metrics use their own HTTP Basic auth, not API key / IdP tokens
    if (isBullBoardRequestPath(path) || isOtelMetricsRequestPath(path)) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const authMethod = getAuthenticationMethod();
    const staticApiKey = process.env.STATIC_API_KEY;
    // api-key: require STATIC_API_KEY to be set and validate it
    const useApiKey = authMethod === 'api-key' && staticApiKey;

    if (authMethod === 'api-key' && !staticApiKey) {
      this.rejectUnauthorized(
        'API key authentication is configured but STATIC_API_KEY is not set. Set STATIC_API_KEY or use a different AUTHENTICATION_METHOD.',
      );
    }

    if (useApiKey) {
      const request = context.switchToHttp().getRequest();
      const authHeader = request.headers.authorization;

      if (!authHeader) {
        this.rejectUnauthorized('Missing authorization header');
      }

      // Support both "Bearer <key>" and "ApiKey <key>" formats
      const parts = authHeader.split(' ');

      if (parts.length !== 2) {
        this.rejectUnauthorized('Invalid authorization header format');
      }

      const [scheme, providedKey] = parts;

      // Accept both "Bearer" and "ApiKey" schemes for API key
      if ((scheme === 'Bearer' || scheme === 'ApiKey') && secretsEqual(providedKey, staticApiKey)) {
        // Attach user object: API key auth always implicates admin rights
        request.user = {
          id: 'api-key-user',
          username: 'api-key',
          roles: ['admin', 'user'],
        };
        // Mark that API key authentication succeeded
        request.apiKeyAuthenticated = true;

        return true;
      }

      // API key doesn't match - reject (no IdP fallback, no anonymous access)
      this.rejectUnauthorized('Invalid API key');
    }

    // users / oidc / saml: let the respective guards handle authentication
    return true;
  }

  private rejectUnauthorized(message: string): never {
    recordSharedCounter('auth.requests.total', { outcome: 'unauthorized' });
    throw new UnauthorizedException(message);
  }
}

/**
 * Guard providers for apps without a local users table (e.g. agent-manager) and the api-key mode:
 * - AUTHENTICATION_METHOD=api-key (and STATIC_API_KEY set): only the API key guard
 * - AUTHENTICATION_METHOD=oidc: API key guard (pass-through) + {@link OidcAuthGuard} (bearer token validation)
 * - AUTHENTICATION_METHOD=users / saml: JWT guards are registered by UsersAuthModule / SamlAuthModule
 */
export function getHybridAuthGuards() {
  const authMethod = getAuthenticationMethod();
  const guards: Array<{ provide: typeof APP_GUARD; useClass: new (...args: never[]) => CanActivate }> = [];

  // Always add HybridAuthGuard (checks AUTHENTICATION_METHOD and STATIC_API_KEY)
  guards.push({
    provide: APP_GUARD,
    useClass: HybridAuthGuard,
  });

  if (authMethod === 'oidc') {
    guards.push({
      provide: APP_GUARD,
      useClass: OidcAuthGuard,
    });
  }

  return guards;
}
