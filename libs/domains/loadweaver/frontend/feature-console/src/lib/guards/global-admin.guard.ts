import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { combineLatest, map, type Observable, switchMap, take, timer } from 'rxjs';

/**
 * Global admins (admin users with `users` / `keycloak` authentication) and the API key: the shared features the
 * control plane registers for them (release announcements).
 */
export function isGlobalAdmin(auth: AuthenticationFacade): Observable<boolean> {
  return combineLatest([auth.canAccessUserManager$, auth.authenticationType$]).pipe(
    map(([admin, type]) => admin || type === 'api-key'),
  );
}

/** The release announcements (`/updates/announcements`); others go back to the updates page. */
export const globalAdminGuard: CanActivateFn = () => {
  const auth = inject(AuthenticationFacade);
  const router = inject(Router);

  auth.checkAuthentication();

  // Next tick: the authentication check has populated the store (as the shared admin guard does).
  return timer(0).pipe(
    switchMap(() => isGlobalAdmin(auth).pipe(take(1))),
    map((allowed) => (allowed ? true : router.createUrlTree(['/updates']))),
  );
};
