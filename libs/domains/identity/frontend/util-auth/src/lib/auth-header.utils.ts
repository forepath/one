import { catchError, from, map, type Observable, of } from 'rxjs';

import { type AuthenticationConfig, usesAppSessionJwt } from './auth-environment';
import { API_KEY_STORAGE_KEY, readLocalStorage, USERS_JWT_STORAGE_KEY } from './auth-storage';
import { getMtlsAuthorizationHeader } from './mtls-credential';
import type { OidcAuthService } from './oidc-auth.service';

/**
 * Resolves the `Authorization` header value for API and socket requests from the console's auth mode:
 * - api-key: configured key or the one stored at login
 * - mtls: certificate assertion signed with the certificate selected at login
 * - users / saml: app session JWT from localStorage
 * - oidc: current access token (silently renewed)
 * Emits null when there is no credential.
 */
export function resolveAuthorizationHeader$(
  authConfig: AuthenticationConfig,
  oidcAuthService?: Pick<OidcAuthService, 'getToken'> | null,
): Observable<string | null> {
  if (authConfig.type === 'api-key') {
    const apiKey = authConfig.apiKey ?? readLocalStorage(API_KEY_STORAGE_KEY);

    return of(apiKey ? `Bearer ${apiKey}` : null);
  }

  if (authConfig.type === 'mtls') {
    return from(
      getMtlsAuthorizationHeader({
        lifetimeSeconds: authConfig.assertionLifetimeSeconds,
        audience: authConfig.audience,
      }),
    ).pipe(catchError(() => of(null)));
  }

  if (usesAppSessionJwt(authConfig.type)) {
    const jwt = readLocalStorage(USERS_JWT_STORAGE_KEY);

    return of(jwt ? `Bearer ${jwt}` : null);
  }

  if (authConfig.type === 'oidc' && oidcAuthService) {
    return from(oidcAuthService.getToken()).pipe(
      map((token) => (token ? `Bearer ${token}` : null)),
      catchError(() => of(null)),
    );
  }

  return of(null);
}
