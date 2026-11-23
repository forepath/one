import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { map, switchMap, take, timer } from 'rxjs';

/** Home pages of a console per mode: the admin overview (admins and managers) and the user overview. */
export interface RoleHomeTargets {
  admin: string[];
  user: string[];
}

/**
 * Resolves `/` (and unknown URLs redirected there) to the home page of the highest available console mode: the admin
 * overview for admins and managers, the user overview otherwise (signed-out users then reach the login through the
 * target's own `authGuard`). Waits for `checkAuthentication` like `adminGuard`, so the role is known on reloads.
 */
export function roleHomeGuard(targets: RoleHomeTargets): CanActivateFn {
  return () => {
    const authFacade = inject(AuthenticationFacade);
    const router = inject(Router);

    authFacade.checkAuthentication();

    return timer(0).pipe(
      switchMap(() => authFacade.canAccessUserManager$.pipe(take(1))),
      map((canAccessAdmin) => router.createUrlTree(canAccessAdmin ? targets.admin : targets.user)),
    );
  };
}
