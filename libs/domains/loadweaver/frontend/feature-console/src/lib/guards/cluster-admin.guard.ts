import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { ConsoleAccessFacade } from '@forepath/loadweaver/frontend/data-access-console';
import { filter, map, switchMap, take } from 'rxjs';

/** Cluster admins only (webhooks, cluster settings): the role from `GET /access/me`. */
export const clusterAdminGuard: CanActivateFn = () => {
  const access = inject(ConsoleAccessFacade);
  const router = inject(Router);

  access.load();

  return access.settled$.pipe(
    filter(Boolean),
    take(1),
    switchMap(() => access.me$.pipe(take(1))),
    map((me) => (me?.clusterRole === 'cluster-admin' ? true : router.createUrlTree(['/overview']))),
  );
};
