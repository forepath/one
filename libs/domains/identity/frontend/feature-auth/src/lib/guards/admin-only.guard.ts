import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { map, switchMap, take, timer } from 'rxjs';

/**
 * Guard for admin-only administration routes (tenant / system settings, identity apps). Managers, who otherwise
 * share the administration UI, are redirected like regular users. Must be used after authGuard.
 *
 * Same timing as {@link adminGuard}: waits for checkAuthentication before evaluating access.
 */
export const adminOnlyGuard: CanActivateFn = () => {
  const authFacade = inject(AuthenticationFacade);
  const router = inject(Router);

  authFacade.checkAuthentication();

  return timer(0).pipe(
    switchMap(() => authFacade.canAccessAdminOnlyAdministration$.pipe(take(1))),
    map((canAccess) => (canAccess ? true : router.createUrlTree(['/']))),
  );
};
