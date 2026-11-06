import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { switchMap } from 'rxjs';

import { isUrlWithinApiBase } from './api-url.utils';
import { IDENTITY_AUTH_ENVIRONMENT } from './auth-environment';
import { resolveAuthorizationHeader$ } from './auth-header.utils';
import { OidcAuthService } from './oidc-auth.service';

export { USERS_JWT_STORAGE_KEY } from './auth-storage';

/**
 * HTTP interceptor that applies the console's credential (API key, OIDC access token, or the users / SAML
 * session JWT) to requests against the configured API base URLs only.
 *
 * Requires `IDENTITY_AUTH_ENVIRONMENT` to be provided in the application.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authEnv = inject(IDENTITY_AUTH_ENVIRONMENT);
  const apiUrl = authEnv.apiUrl;
  const additionalUrls = authEnv.additionalApiUrls ?? [];
  const urlMatches =
    isUrlWithinApiBase(req.url, apiUrl) || additionalUrls.some((base) => isUrlWithinApiBase(req.url, base));

  if (!urlMatches) {
    return next(req);
  }

  const oidcAuthService = authEnv.authentication.type === 'oidc' ? inject(OidcAuthService) : null;

  return resolveAuthorizationHeader$(authEnv.authentication, oidcAuthService).pipe(
    switchMap((authorization) =>
      authorization ? next(req.clone({ setHeaders: { Authorization: authorization } })) : next(req),
    ),
  );
};

/**
 * Returns the authentication HTTP interceptor function.
 * Use this with `withInterceptors` from `@angular/common/http`.
 *
 * @example
 * ```typescript
 * provideHttpClient(withInterceptors([getAuthInterceptor()]));
 * ```
 */
export function getAuthInterceptor(): HttpInterceptorFn {
  return authInterceptor;
}
