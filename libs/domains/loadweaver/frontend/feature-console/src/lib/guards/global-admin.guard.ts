import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { ConsoleAccessFacade, ConsoleEndpointService } from '@forepath/loadweaver/frontend/data-access-console';
import { combineLatest, filter, map, type Observable, switchMap, take, timer } from 'rxjs';

/**
 * Global admins (admin users with `users` / `keycloak` authentication) and the API key: the shared features the
 * control plane registers for them (release announcements).
 */
export function isGlobalAdmin(auth: AuthenticationFacade): Observable<boolean> {
  return combineLatest([auth.canAccessUserManager$, auth.authenticationType$]).pipe(
    map(([admin, type]) => admin || type === 'api-key'),
  );
}

/**
 * The release announcements (`/updates/announcements`) and the fleet audit; others go back to the updates page. In a
 * fleet's cluster view (full parity, 2026-10-27) the cluster-wide admin grant counts — the relay acts with the cluster's
 * service user; at the fleet level (no cluster open) the fleet admin role does.
 */
export const globalAdminGuard: CanActivateFn = () => {
  const auth = inject(AuthenticationFacade);
  const router = inject(Router);
  const endpoints = inject(ConsoleEndpointService);
  // Inside a fleet's cluster view the cluster grant decides; at the fleet level (fleet audit, no cluster open) there is
  // no cluster access to wait for (it stays `null` and the page never rendered): the fleet's admin role decides.
  const access = endpoints.fleetMode && endpoints.activeClusterId() !== null ? inject(ConsoleAccessFacade) : null;

  auth.checkAuthentication();
  // Nobody else loads the access before the first navigation ends (the shell renders only then): waiting for `me$`
  // alone kept a direct load of `/updates/announcements` blank forever (LW-24). Load it and wait until it settled.
  access?.load();

  // Next tick: the authentication check has populated the store (as the shared admin guard does).
  return timer(0).pipe(
    switchMap(() =>
      access
        ? access.settled$.pipe(
            filter(Boolean),
            take(1),
            switchMap(() => access.me$.pipe(take(1))),
            map((me) => me?.clusterRole === 'cluster-admin'),
          )
        : isGlobalAdmin(auth).pipe(take(1)),
    ),
    map((allowed) => (allowed ? true : router.createUrlTree(['/delivery/updates']))),
  );
};
