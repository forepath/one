import { inject } from '@angular/core';
import { ActivatedRoute, Router, type ActivatedRouteSnapshot, type CanActivateFn } from '@angular/router';
// Avoid data-access barrel: it re-exports identity (Keycloak), which breaks lightweight Jest runs.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { ClientsFacade } from '@forepath/agenstra/frontend/data-access-agent-console';
import { map, take } from 'rxjs';

/**
 * Workspace-scoped page routing (tickets, knowledge, tasks):
 * - `/<page>/:clientId` - activates that workspace and shows its page (deep link / bookmark).
 * - `/<page>` - redirects to `/<page>/{activeClientId}` when a workspace is already selected;
 *   otherwise allows activation so the page can open the workspace picker (locale prefix via `relativeTo`).
 *
 * `<page>` is the first segment of the matched route path (defaults to `tickets`).
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
        return router.createUrlTree([route.routeConfig?.path?.split('/')[0] || 'tickets', activeId], { relativeTo });
      }

      return true;
    }),
  );
};
