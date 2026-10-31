import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { ConsoleFleetFacade } from '@forepath/loadweaver/frontend/data-access-console';
import { combineLatest, filter, map, switchMap, take, tap } from 'rxjs';

import { fleetCompareAvailable } from '../fleet/fleet-format';

/**
 * `/fleet/compare` only while the fleet has at least 2 clusters the caller can see (2026-10-28); otherwise the fleet
 * overview. Waits for the cluster list (loads it when it was never loaded); a failed load counts as "no clusters".
 */
export const fleetCompareGuard: CanActivateFn = () => {
  const fleet = inject(ConsoleFleetFacade);
  const router = inject(Router);

  // Single-cluster mode: `fleetModeOnlyGuard` sends the route away; nothing to load here.
  if (!fleet.fleetMode) return true;

  return combineLatest([fleet.clustersLoaded$, fleet.clustersLoading$]).pipe(
    take(1),
    tap(([loaded, loading]) => {
      if (!loaded && !loading) fleet.loadClusters();
    }),
    switchMap(() => fleet.clustersLoaded$.pipe(filter(Boolean), take(1))),
    switchMap(() => fleet.clusters$.pipe(take(1))),
    map((clusters) => (fleetCompareAvailable(clusters) ? true : router.createUrlTree(['/fleet']))),
  );
};
