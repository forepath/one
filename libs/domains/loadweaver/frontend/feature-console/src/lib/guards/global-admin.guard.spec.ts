import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { ConsoleAccessFacade, ConsoleEndpointService } from '@forepath/loadweaver/frontend/data-access-console';
import { firstValueFrom, isObservable, of, type Observable } from 'rxjs';

import { globalAdminGuard } from './global-admin.guard';

/** Release announcements: global admins natively, the cluster-wide admin grant in a fleet's cluster view (parity). */
describe('globalAdminGuard', () => {
  const load = jest.fn();

  async function run(
    fleetMode: boolean,
    clusterRole: string | null,
    globalAdmin = false,
    activeClusterId: string | null = fleetMode ? 'c-1' : null,
  ): Promise<unknown> {
    TestBed.resetTestingModule();
    load.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ConsoleEndpointService, useValue: { fleetMode, activeClusterId: () => activeClusterId } },
        {
          provide: ConsoleAccessFacade,
          // No cluster open: the access stays null (no roles), so a guard waiting for it would never settle.
          useValue: {
            me$: of(activeClusterId ? { userId: 'u', clusterRole, projects: {} } : null),
            settled$: of(true),
            load,
          },
        },
        {
          provide: AuthenticationFacade,
          useValue: {
            checkAuthentication: jest.fn(),
            canAccessUserManager$: of(globalAdmin),
            authenticationType$: of('users'),
          },
        },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      globalAdminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    const value = isObservable(result) ? await firstValueFrom(result as Observable<unknown>) : result;

    return value instanceof UrlTree ? TestBed.inject(Router).serializeUrl(value) : value;
  }

  it('lets global admins in natively', async () => {
    expect(await run(false, 'cluster-admin', true)).toBe(true);
    expect(await run(false, 'cluster-admin', false)).toBe('/delivery/updates');
  });

  it('lets the cluster-wide admin grant in through the fleet', async () => {
    expect(await run(true, 'cluster-admin')).toBe(true);
    // It loads the access itself: a direct load of the page has nobody else doing it (LW-24, blank page).
    expect(load).toHaveBeenCalled();
    expect(await run(true, 'infra-operator')).toBe('/delivery/updates');
  });

  it('fleet level (no cluster open, e.g. the fleet audit): the fleet admin role decides, without waiting', async () => {
    expect(await run(true, null, true, null)).toBe(true);
    expect(await run(true, null, false, null)).toBe('/delivery/updates');
  });
});
