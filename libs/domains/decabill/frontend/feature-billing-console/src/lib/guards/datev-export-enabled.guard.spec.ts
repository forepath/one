import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { BillingCapabilitiesFacade } from '@forepath/decabill/frontend/data-access-billing-console';
import { firstValueFrom, of } from 'rxjs';

import { datevExportEnabledGuard } from './datev-export-enabled.guard';

describe('datevExportEnabledGuard', () => {
  let facade: {
    loadCapabilities: jest.Mock;
    capabilities$: ReturnType<typeof of>;
    loading$: ReturnType<typeof of>;
  };
  const router = {
    createUrlTree: jest.fn().mockReturnValue({} as UrlTree),
  };

  beforeEach(() => {
    facade = {
      loadCapabilities: jest.fn(),
      capabilities$: of({ datevExportEnabled: true, unifiedExportAllowed: false }),
      loading$: of(false),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: BillingCapabilitiesFacade, useValue: facade },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('allows navigation when datev export is enabled', async () => {
    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(datevExportEnabledGuard({} as never, {} as never)),
    );

    expect(result).toBe(true);
    expect(facade.loadCapabilities).toHaveBeenCalled();
  });

  it('redirects when datev export is disabled', async () => {
    facade.capabilities$ = of({ datevExportEnabled: false, unifiedExportAllowed: false });

    const result = await TestBed.runInInjectionContext(() =>
      firstValueFrom(datevExportEnabledGuard({} as never, {} as never)),
    );

    expect(router.createUrlTree).toHaveBeenCalledWith(['/administration/billing']);
    expect(result).toEqual({});
  });
});
