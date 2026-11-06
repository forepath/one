import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { map, switchMap, take, timer } from 'rxjs';

/**
 * Guard that protects routes requiring admin role with users, oidc or saml authentication.
 * Must be used after authGuard. Redirects to /clients if the user is not admin
 * or if authentication type is not users/oidc/saml.
 *
 * Dispatches checkAuthentication and waits for it to complete before evaluating access,
 * so direct navigation to /users works correctly (store is populated before the check).
 */
export const adminGuard: CanActivateFn = () => {
  const authFacade = inject(AuthenticationFacade);
  const router = inject(Router);

  authFacade.checkAuthentication();

  // Yield to next tick so checkAuthentication effect completes (sync or async), then evaluate access
  return timer(0).pipe(
    switchMap(() => authFacade.canAccessUserManager$.pipe(take(1))),
    map((canAccess) => (canAccess ? true : router.createUrlTree(['/clients']))),
  );
};
