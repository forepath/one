import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  AccountingFacade,
  AdminAccountingService,
  BillingCapabilitiesFacade,
  type AccountingAssetScheduleRow,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { BehaviorSubject, of } from 'rxjs';

import { AccountingAssetsPageComponent } from './accounting-assets-page.component';

const empty = () => new BehaviorSubject({ data: null, loading: false, error: null, loaded: false });

describe('AccountingAssetsPageComponent', () => {
  const facade = {
    assets$: empty(),
    asset$: empty(),
    assetSchedule$: empty(),
    mutating$: new BehaviorSubject(false),
    mutationError$: new BehaviorSubject<string | null>(null),
    lastMutation$: new BehaviorSubject<unknown>(null),
    viewTenantId$: new BehaviorSubject<string | null>(null),
    load: jest.fn(),
    mutate: jest.fn(),
    clear: jest.fn(),
    clearMutation: jest.fn(),
    setViewTenant: jest.fn(),
  };
  const capabilities = {
    accountingGlobalAccess$: new BehaviorSubject(true),
    viewableTenants$: new BehaviorSubject(['default']),
    loadCapabilities: jest.fn(),
  };
  const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };

  function create() {
    TestBed.configureTestingModule({
      imports: [AccountingAssetsPageComponent],
      providers: [
        { provide: AccountingFacade, useValue: facade },
        { provide: BillingCapabilitiesFacade, useValue: capabilities },
        { provide: AdminAccountingService, useValue: { getAsset: jest.fn().mockReturnValue(of(new Blob())) } },
        { provide: Router, useValue: router },
        { provide: ENVIRONMENT, useValue: { billing: { tenantId: 'default', urls: { restApi: 'http://api' } } } },
      ],
    });

    return TestBed.runInInjectionContext(() => new AccountingAssetsPageComponent());
  }

  beforeEach(() => {
    facade.load.mockClear();
    facade.mutate.mockClear();
    router.navigate.mockClear();
  });

  it('loads the register and the schedule of the current year', () => {
    const page = create();

    page.ngOnInit();
    TestBed.tick();

    const year = new Date().getFullYear();

    expect(capabilities.loadCapabilities).toHaveBeenCalled();
    // Server-paged register: first page, no 200-row cap.
    expect(facade.load).toHaveBeenCalledWith({
      key: 'assets',
      params: expect.objectContaining({ limit: 25, offset: 0 }),
    });
    expect(facade.load).toHaveBeenCalledWith({
      key: 'assetSchedule',
      range: { from: `${year}-01-01`, to: `${year}-12-31` },
    });
  });

  it('runs the depreciation through the chosen month', () => {
    const page = create();

    page.openDepreciation();
    page.depreciationMonth = '2026-10';
    page.submitDepreciation();

    expect(facade.mutate).toHaveBeenCalledWith({ kind: 'runDepreciation', through: '2026-10' });
  });

  it('creates an asset without empty optional fields', () => {
    const page = create();

    page.openCreate();
    page.form = { ...page.form, name: ' Laptop ', acquisitionDate: '2026-03-01', acquisitionCost: 1200 };
    page.submitCreate();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'createAsset',
      dto: { name: 'Laptop', acquisitionDate: '2026-03-01', acquisitionCost: 1200 },
    });
  });

  it('sums the schedule and links bookings to the journal', () => {
    const row = (closing: number): AccountingAssetScheduleRow =>
      ({
        id: `a${closing}`,
        acquisitionDate: '2025-01-01',
        openingCost: 0,
        additions: 0,
        disposals: 0,
        closingCost: 0,
        openingDepreciation: 0,
        depreciation: 10,
        openingBookValue: 0,
        closingBookValue: closing,
      }) as AccountingAssetScheduleRow;

    facade.assetSchedule$.next({ data: [row(100), row(50.5)], loading: false, error: null, loaded: true } as never);

    const page = create();

    expect(page.scheduleTotals().closingBookValue).toBe(150.5);
    expect(page.scheduleTotals().depreciation).toBe(20);

    page.openBookings('asset-1');

    expect(router.navigate).toHaveBeenCalledWith(['/administration/accounting/journal'], {
      queryParams: { linkType: 'fixed_asset', targetId: 'asset-1' },
    });
  });
});
