import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { ConsoleFleetFacade } from '@forepath/loadweaver/frontend/data-access-console';
import { type BehaviorSubject, firstValueFrom, isObservable, type Observable } from 'rxjs';

import { fleetCompareAvailable } from '../fleet/fleet-format';
import { facadeStub } from '../testing';
import { fleetCompareGuard } from './fleet-compare.guard';

describe('fleet compare gating', () => {
  it('offers Compare only with at least 2 visible clusters', () => {
    expect(fleetCompareAvailable(null)).toBe(false);
    expect(fleetCompareAvailable([])).toBe(false);
    expect(fleetCompareAvailable([{ id: 'a' }])).toBe(false);
    expect(fleetCompareAvailable([{ id: 'a' }, { id: 'b' }])).toBe(true);
  });

  function run(streams: Record<string, unknown>, fleetMode = true) {
    const fleet = { ...facadeStub(streams, ['loadClusters']), fleetMode };

    TestBed.configureTestingModule({ providers: [{ provide: ConsoleFleetFacade, useValue: fleet }] });
    const result = TestBed.runInInjectionContext(() =>
      fleetCompareGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    return { fleet, result };
  }

  async function resolve(result: unknown): Promise<unknown> {
    return isObservable(result) ? firstValueFrom(result as Observable<unknown>) : result;
  }

  it('lets the route through with 2 clusters', async () => {
    const { fleet, result } = run({
      clusters$: [{ id: 'a' }, { id: 'b' }],
      clustersLoaded$: true,
      clustersLoading$: false,
    });

    expect(await resolve(result)).toBe(true);
    expect(fleet['loadClusters']).not.toHaveBeenCalled();
  });

  it('sends a fleet with a single cluster to the fleet overview', async () => {
    const { result } = run({ clusters$: [{ id: 'a' }], clustersLoaded$: true, clustersLoading$: false });
    const tree = (await resolve(result)) as UrlTree;

    expect(tree).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe('/fleet');
  });

  it('loads the cluster list first when it was never loaded', async () => {
    const { fleet, result } = run({ clusters$: [], clustersLoaded$: false, clustersLoading$: false });
    const pending = resolve(result);

    expect(fleet['loadClusters']).toHaveBeenCalled();
    (fleet['clusters$'] as BehaviorSubject<unknown>).next([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    (fleet['clustersLoaded$'] as BehaviorSubject<unknown>).next(true);
    expect(await pending).toBe(true);
  });

  it('does nothing in single-cluster mode', () => {
    const { result } = run({ clusters$: [], clustersLoaded$: false, clustersLoading$: false }, false);

    expect(result).toBe(true);
  });
});
