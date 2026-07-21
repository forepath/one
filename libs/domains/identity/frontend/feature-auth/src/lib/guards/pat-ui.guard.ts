import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

// eslint-disable-next-line @nx/enforce-module-boundaries
import { IDENTITY_AUTH_ENVIRONMENT, type IdentityAuthEnvironment } from '../../../../util-auth/src';

/**
 * Allows `/settings/tokens` only when auth mode supports PATs (users or keycloak).
 * api-key mode has no PAT APIs — redirect home.
 */
export const patUiGuard: CanActivateFn = () => {
  const environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  const router = inject(Router);
  const type = environment.authentication.type;

  if (type === 'users' || type === 'keycloak') {
    return true;
  }

  return router.createUrlTree(['/']);
};
