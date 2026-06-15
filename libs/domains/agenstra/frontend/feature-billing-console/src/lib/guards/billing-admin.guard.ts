import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthenticationFacade } from '@forepath/agenstra/frontend/data-access-agent-console';
import { map, switchMap, take, timer } from 'rxjs';

/**
 * Guard that protects billing administration routes (e.g. service types, service plans).
 * Redirects to billing overview if the user does not have admin access.
 */
export const billingAdminGuard: CanActivateFn = () => {
  const authFacade = inject(AuthenticationFacade);
  const router = inject(Router);

  authFacade.checkAuthentication();

  return timer(0).pipe(
    switchMap(() => authFacade.canAccessBillingAdministration$.pipe(take(1))),
    map((canAccess) => (canAccess ? true : router.createUrlTree(['/']))),
  );
};
