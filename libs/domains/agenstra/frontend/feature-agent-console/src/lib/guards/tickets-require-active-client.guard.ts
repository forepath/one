import { inject } from '@angular/core';
import { ActivatedRoute, Router, type ActivatedRouteSnapshot, type CanActivateFn } from '@angular/router';
// Avoid data-access barrel: it re-exports identity (Keycloak), which breaks lightweight Jest runs.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { ClientsFacade } from '@forepath/agenstra/frontend/data-access-agent-console';
import { map, take } from 'rxjs';

/**
 * Tickets routing:
 * - `/tickets/:clientId` — activates that workspace and shows its board (deep link / bookmark).
 * - `/tickets` — redirects to `/tickets/{activeClientId}` when a workspace is already selected;
 *   otherwise allows activation so the board can open the workspace picker (locale prefix via `relativeTo`).
 */
export const ticketsRequireActiveClientGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const clientsFacade = inject(ClientsFacade);
  const router = inject(Router);
  const activatedRoute = inject(ActivatedRoute);
  const relativeTo = activatedRoute.parent ?? undefined;
  const clientIdFromUrl = route.paramMap.get('clientId')?.trim();

  if (clientIdFromUrl) {
    clientsFacade.setActiveClient(clientIdFromUrl);

    return true;
  }

  return clientsFacade.activeClientId$.pipe(
    take(1),
    map((activeId) => {
      if (activeId) {
        return router.createUrlTree(['tickets', activeId], { relativeTo });
      }

      return true;
    }),
  );
};
