import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  AccountingFacade,
  AdminAccountingService,
  BillingCapabilitiesFacade,
  type AccountingFiscalYear,
  type AccountingPeriod,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { BehaviorSubject, of } from 'rxjs';

import { AccountingOverviewPageComponent } from './accounting-overview-page.component';

const empty = () => new BehaviorSubject({ data: null, loading: false, error: null, loaded: false });

describe('AccountingOverviewPageComponent', () => {
  let facade: Record<string, unknown> & {
    load: jest.Mock;
    mutate: jest.Mock;
    clearMutation: jest.Mock;
  };
  let capabilities: { accountingGlobalAccess$: BehaviorSubject<boolean>; loadCapabilities: jest.Mock };

  function create() {
    TestBed.configureTestingModule({
      imports: [AccountingOverviewPageComponent],
      providers: [
        { provide: AccountingFacade, useValue: facade },
        { provide: BillingCapabilitiesFacade, useValue: { ...capabilities, viewableTenants$: of(['default']) } },
        { provide: AdminAccountingService, useValue: { downloadExport: jest.fn().mockReturnValue(of(new Blob())) } },
        { provide: Router, useValue: { navigate: jest.fn(), navigateByUrl: jest.fn() } },
        { provide: ENVIRONMENT, useValue: { billing: { tenantId: 'default', urls: { restApi: 'http://api' } } } },
      ],
    });

    return TestBed.runInInjectionContext(() => new AccountingOverviewPageComponent());
  }

  beforeEach(() => {
    facade = {
      overview$: empty(),
      fiscalYears$: empty(),
      charts$: empty(),
      templates$: empty(),
      postingIssues$: empty(),
      fxRates$: empty(),
      closePreview$: empty(),
      viewTenantId$: new BehaviorSubject(null),
      mutating$: new BehaviorSubject(false),
      mutationError$: new BehaviorSubject<string | null>(null),
      lastMutation$: new BehaviorSubject(null),
      load: jest.fn(),
      mutate: jest.fn(),
      clear: jest.fn(),
      clearMutation: jest.fn(),
      setViewTenant: jest.fn(),
    };
    capabilities = { accountingGlobalAccess$: new BehaviorSubject(true), loadCapabilities: jest.fn() };
  });

  it('loads the overview, fiscal years, charts and rates', () => {
    const page = create();

    page.ngOnInit();

    expect(capabilities.loadCapabilities).toHaveBeenCalled();
    expect(facade.load).toHaveBeenCalledWith({ key: 'overview' });
    expect(facade.load).toHaveBeenCalledWith({ key: 'fiscalYears' });
    expect(facade.load).toHaveBeenCalledWith({ key: 'charts' });
    expect(facade.load).toHaveBeenCalledWith({ key: 'fxRates', params: { limit: 100, offset: 0 } });
  });

  it('locks a period after confirmation', () => {
    const page = create();

    page.requestLock({ id: 'p1', status: 'open' } as AccountingPeriod);
    page.confirmLock();

    expect(facade.mutate).toHaveBeenCalledWith({ kind: 'lockPeriod', periodId: 'p1' });
    expect(page.lockTarget()).toBeNull();
  });

  it('previews and closes a year with the edited account mapping', () => {
    const page = create();

    page.openCloseYear({ id: 'y1', name: '2025' } as AccountingFiscalYear);
    page.closeNextChartId = 'c2';
    page.setMapping('1200', '1800');
    page.submitCloseYear();

    expect(facade.load).toHaveBeenCalledWith({ key: 'closePreview', fiscalYearId: 'y1', dto: {} });
    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'closeFiscalYear',
      fiscalYearId: 'y1',
      dto: { nextChartId: 'c2', accountMapping: { '1200': '1800' } },
    });
  });

  it('creates an empty chart and stores a manual rate', () => {
    const page = create();

    page.openChartModal();
    page.chartForm = {
      mode: 'empty',
      templateKey: '',
      code: 'OWN',
      name: 'Own chart',
      country: 'de',
      accountLength: 4,
    };
    page.submitChart();
    page.fxForm = { currency: 'usd', rateDate: '2026-11-02', rate: 1.08 };
    page.submitFxRate();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'createChart',
      dto: { code: 'OWN', name: 'Own chart', country: 'DE', accountLength: 4 },
    });
    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'setFxRate',
      dto: { currency: 'USD', rateDate: '2026-11-02', rate: 1.08 },
    });
  });
});
