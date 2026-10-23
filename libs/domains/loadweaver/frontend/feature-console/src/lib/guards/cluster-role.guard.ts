import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { ConsoleAccessFacade } from '@forepath/loadweaver/frontend/data-access-console';
import { filter, map, switchMap, take } from 'rxjs';

/** Any cluster role (the cluster's own views, e.g. ingress certificates): the role from `GET /access/me`. */
export const clusterRoleGuard: CanActivateFn = () => {
  const access = inject(ConsoleAccessFacade);
  const router = inject(Router);

  access.load();

  return access.settled$.pipe(
    filter(Boolean),
    take(1),
    switchMap(() => access.me$.pipe(take(1))),
    map((me) => (me?.clusterRole ? true : router.createUrlTree(['/overview']))),
  );
};
