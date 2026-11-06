import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

// eslint-disable-next-line @nx/enforce-module-boundaries
import { IDENTITY_AUTH_ENVIRONMENT, type IdentityAuthEnvironment } from '../../../../util-auth/src';

/**
 * Allows `/settings/tokens` only when auth mode supports PATs (users, oidc or saml).
 * api-key / mtls modes have no PAT APIs - redirect home.
 */
export const patUiGuard: CanActivateFn = () => {
  const environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  const router = inject(Router);
  const type = environment.authentication.type;

  if (type === 'users' || type === 'oidc' || type === 'saml') {
    return true;
  }

  return router.createUrlTree(['/']);
};
