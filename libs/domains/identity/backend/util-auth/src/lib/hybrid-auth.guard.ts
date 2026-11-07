import { recordSharedCounter } from '@forepath/shared/backend/util-otel/metrics';
import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';

import { API_KEY_PRINCIPAL_ID, getAuthenticationMethod, MTLS_PRINCIPAL_ID } from './authentication-method';
import { isBullBoardRequestPath } from './bull-board-request-path';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { authenticateMtls } from './mtls/mtls-authenticator';
import { getMtlsConfig, MtlsConfigurationError } from './mtls/mtls.config';
import { OidcAuthGuard } from './oidc/oidc-auth.guard';
import { isOtelMetricsRequestPath } from './otel-metrics-request-path';
import { secretsEqual } from './secret-compare';

/**
 * Guard that validates the static credential methods.
 * - AUTHENTICATION_METHOD 'api-key' (or STATIC_API_KEY set for backward compatibility): only the static API key
 * - AUTHENTICATION_METHOD 'mtls': only a trusted client certificate (TLS handshake or certificate assertion)
 *
 * Both grant full admin access (no IdP fallback, no anonymous access) and mark the request `apiKeyAuthenticated`.
 * When 'users', 'oidc' or 'saml', this guard allows requests to proceed to the respective auth guards.
 */
@Injectable()
export class HybridAuthGuard implements CanActivate {
  private readonly logger = new Logger(HybridAuthGuard.name);

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

    if (authMethod === 'mtls') {
      return this.authenticateClientCertificate(request);
    }

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
          id: API_KEY_PRINCIPAL_ID,
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

  /** mtls: client certificate from the TLS handshake or an `Authorization: Certificate <assertion>` header. */
  private authenticateClientCertificate(request: {
    headers: Record<string, unknown>;
    socket?: unknown;
    user?: unknown;
    apiKeyAuthenticated?: boolean;
    clientCertificate?: unknown;
  }): boolean {
    let result: ReturnType<typeof authenticateMtls>;

    try {
      result = authenticateMtls({ authorization: request.headers['authorization'], transportSocket: request.socket });
    } catch (error) {
      if (error instanceof MtlsConfigurationError) {
        this.rejectUnauthorized(error.message);
      }

      throw error;
    }

    if ('reason' in result) {
      if (result.presented) {
        this.logger.warn(`Client certificate rejected: ${result.reason}`);
      }

      this.rejectUnauthorized(result.presented ? 'Invalid client certificate' : 'Missing client certificate');
    }

    // A trusted client certificate implicates admin rights, exactly like the static API key.
    request.user = {
      id: MTLS_PRINCIPAL_ID,
      username: result.principal.commonName ?? 'mtls',
      roles: ['admin', 'user'],
    };
    request.apiKeyAuthenticated = true;
    request.clientCertificate = result.principal;

    return true;
  }

  private rejectUnauthorized(message: string): never {
    recordSharedCounter('auth.requests.total', { outcome: 'unauthorized' });
    throw new UnauthorizedException(message);
  }
}

/**
 * Guard providers for apps without a local users table (e.g. agent-manager) and the static credential modes:
 * - AUTHENTICATION_METHOD=api-key (and STATIC_API_KEY set): only the API key guard
 * - AUTHENTICATION_METHOD=mtls: only the client certificate guard (the mTLS configuration is validated here, so a
 *   missing or invalid MTLS_CA_CERT fails at boot)
 * - AUTHENTICATION_METHOD=oidc: API key guard (pass-through) + {@link OidcAuthGuard} (bearer token validation)
 * - AUTHENTICATION_METHOD=users / saml: JWT guards are registered by UsersAuthModule / SamlAuthModule
 */
export function getHybridAuthGuards() {
  const authMethod = getAuthenticationMethod();

  if (authMethod === 'mtls') {
    getMtlsConfig();
  }

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
