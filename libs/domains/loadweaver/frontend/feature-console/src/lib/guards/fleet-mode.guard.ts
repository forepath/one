import { inject } from '@angular/core';
import { Router, UrlSegment, type CanActivateChildFn, type CanActivateFn, type UrlMatchResult } from '@angular/router';
import {
  ConsoleEndpointService,
  fleetClusterSwitched,
  isFleetClusterId,
} from '@forepath/loadweaver/frontend/data-access-console';
import { Store } from '@ngrx/store';

import { isBareRoute } from '../container/container.component';
import { isFleetLevelPath, isFleetUnavailablePath } from '../fleet/fleet-format';

/**
 * The console's routing per mode (3.24), on the shell route's children:
 * - single-cluster mode: the fleet routes (`/fleet/…`, `/clusters/<id>/…`) lead to the overview, everything else is
 *   unchanged;
 * - fleet mode: fleet and account routes always; cluster views only with an active cluster (otherwise the fleet
 *   overview); routes the relay never carries show the "not available through the fleet" page.
 */
export const fleetConsoleGuard: CanActivateChildFn = (_route, state) => {
  const endpoints = inject(ConsoleEndpointService);
  const router = inject(Router);
  const url = state.url;

  if (!endpoints.fleetMode)
    return /^\/(fleet|clusters)(\/|\?|$)/.test(stripLocale(url)) ? router.createUrlTree(['/overview']) : true;

  if (isBareRoute(url) || isFleetLevelPath(url)) return true;

  if (isFleetUnavailablePath(url))
    return router.createUrlTree(['/fleet/unavailable'], { queryParams: { page: stripLocale(url).split('?')[0] } });

  return endpoints.activeClusterId() ? true : router.createUrlTree(['/fleet']);
};

function stripLocale(url: string): string {
  return url.replace(/^\/(de|en)(?=\/|$)/, '') || '/';
}

/** `clusters/<id>/<path…>`: the links of fleet cards and the merged inbox. */
export function fleetClusterLinkMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length < 2 || segments[0].path !== 'clusters' || !isFleetClusterId(segments[1].path)) return null;

  return { consumed: segments, posParams: { clusterId: segments[1] } };
}

/**
 * Entry of a fleet link: makes the cluster active (cluster-scoped state is reset when it changes) and continues at
 * the path inside it, e.g. `/clusters/<id>/plans/<plan>` → `/plans/<plan>` through that cluster's relay.
 */
export const fleetClusterEntryGuard: CanActivateFn = (route) => {
  const endpoints = inject(ConsoleEndpointService);
  const router = inject(Router);
  const store = inject(Store);
  const clusterId = route.paramMap.get('clusterId');
  const rest = route.url.slice(2).map((segment) => segment.path);
  const target = router.createUrlTree(rest.length > 0 ? ['/', ...rest] : ['/overview'], {
    queryParams: route.queryParams,
  });

  if (!endpoints.fleetMode || !isFleetClusterId(clusterId)) return router.createUrlTree(['/overview']);

  if (endpoints.activeClusterId() !== clusterId) {
    endpoints.setActiveCluster(clusterId);
    store.dispatch(fleetClusterSwitched({ clusterId }));
  }

  return target;
};

/** Fleet pages only exist in fleet mode. */
export const fleetModeOnlyGuard: CanActivateFn = () =>
  inject(ConsoleEndpointService).fleetMode ? true : inject(Router).createUrlTree(['/overview']);
