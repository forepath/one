import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { ConsoleAccessFacade, type AccessMe } from '@forepath/loadweaver/frontend/data-access-console';
import { filter, map, switchMap, take } from 'rxjs';

/**
 * Where `/` lands (3.37): Resources → Cluster → Summary for cluster roles (and callers without any membership); project
 * members on their first project's Summary.
 */
export function landingCommands(me: Pick<AccessMe, 'clusterRole' | 'projects'> | null): string[] {
  if (me?.clusterRole) return ['/resources', 'cluster'];

  const first = Object.keys(me?.projects ?? {}).sort()[0];

  return first ? ['/resources', 'project', first] : ['/resources', 'cluster'];
}

/** Resolves `/` to the landing page once the caller's access is known. */
export const landingGuard: CanActivateFn = () => {
  const access = inject(ConsoleAccessFacade);
  const router = inject(Router);

  access.load();

  return access.settled$.pipe(
    filter(Boolean),
    take(1),
    switchMap(() => access.me$.pipe(take(1))),
    map((me): UrlTree => router.createUrlTree(landingCommands(me))),
  );
};
