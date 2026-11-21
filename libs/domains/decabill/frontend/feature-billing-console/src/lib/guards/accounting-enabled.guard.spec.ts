import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { BillingCapabilitiesFacade } from '@forepath/decabill/frontend/data-access-billing-console';
import { BehaviorSubject, firstValueFrom, type Observable, of } from 'rxjs';

import { accountingEnabledGuard, accountingGlobalAccessGuard } from './accounting-enabled.guard';

describe('accountingEnabledGuard', () => {
  let facade: {
    loadCapabilities: jest.Mock;
    accountingEnabled$: BehaviorSubject<boolean>;
    accountingGlobalAccess$: BehaviorSubject<boolean>;
    loading$: Observable<boolean>;
  };
  const router = { createUrlTree: jest.fn().mockReturnValue({} as UrlTree) };

  beforeEach(() => {
    facade = {
      loadCapabilities: jest.fn(),
      accountingEnabled$: new BehaviorSubject(true),
      accountingGlobalAccess$: new BehaviorSubject(true),
      loading$: of(false),
    };
    router.createUrlTree.mockClear();

    TestBed.configureTestingModule({
      providers: [
        { provide: BillingCapabilitiesFacade, useValue: facade },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('allows navigation when accounting is enabled', async () => {
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(accountingEnabledGuard({} as never, {} as never)),
    );

    expect(result).toBe(true);
    expect(facade.loadCapabilities).toHaveBeenCalled();
  });

  it('redirects to billing administration when accounting is disabled', async () => {
    facade.accountingEnabled$.next(false);

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(accountingEnabledGuard({} as never, {} as never)),
    );

    expect(router.createUrlTree).toHaveBeenCalledWith(['/administration/billing']);
    expect(result).toEqual({});
  });

  it('waits until the capabilities are loaded', async () => {
    const loading$ = new BehaviorSubject(true);

    facade.loading$ = loading$;

    const pending = TestBed.runInInjectionContext(() =>
      firstValueFrom(accountingEnabledGuard({} as never, {} as never)),
    );

    loading$.next(false);

    expect(await pending).toBe(true);
  });

  it('lets global viewers open entity-wide pages and sends tenant admins to the accounting overview', async () => {
    expect(
      await TestBed.runInInjectionContext(() => firstValueFrom(accountingGlobalAccessGuard({} as never, {} as never))),
    ).toBe(true);

    facade.accountingGlobalAccess$.next(false);

    await TestBed.runInInjectionContext(() => firstValueFrom(accountingGlobalAccessGuard({} as never, {} as never)));

    expect(router.createUrlTree).toHaveBeenCalledWith(['/administration/accounting']);
  });
});
