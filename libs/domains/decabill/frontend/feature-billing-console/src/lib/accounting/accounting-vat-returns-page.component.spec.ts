import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  AccountingFacade,
  AdminAccountingService,
  BillingCapabilitiesFacade,
  type AccountingVatReturn,
  type AccountingVatReturnDefinition,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { BehaviorSubject, of } from 'rxjs';

import {
  AccountingVatReturnsPageComponent,
  lastCompletedVatPeriod,
  vatPeriodBounds,
} from './accounting-vat-returns-page.component';

const resource = (data: unknown = null) =>
  new BehaviorSubject<{ data: unknown; loading: boolean; error: string | null; loaded: boolean }>({
    data,
    loading: false,
    error: null,
    loaded: data !== null,
  });

describe('vatPeriodBounds', () => {
  it('computes month, quarter and year bounds', () => {
    expect(vatPeriodBounds('month', 2026, 2)).toEqual({ periodStart: '2026-02-01', periodEnd: '2026-02-28' });
    expect(vatPeriodBounds('quarter', 2026, 3)).toEqual({ periodStart: '2026-07-01', periodEnd: '2026-09-30' });
    expect(vatPeriodBounds('quarter', 2024, 1)).toEqual({ periodStart: '2024-01-01', periodEnd: '2024-03-31' });
    expect(vatPeriodBounds('year', 2026, 1)).toEqual({ periodStart: '2026-01-01', periodEnd: '2026-12-31' });
  });
});

describe('lastCompletedVatPeriod', () => {
  it('rolls back into the previous year in January and the first quarter', () => {
    expect(lastCompletedVatPeriod('month', new Date(2027, 0, 5))).toEqual({ year: 2026, index: 12 });
    expect(lastCompletedVatPeriod('month', new Date(2027, 4, 5))).toEqual({ year: 2027, index: 4 });
    expect(lastCompletedVatPeriod('quarter', new Date(2027, 1, 10))).toEqual({ year: 2026, index: 4 });
    expect(lastCompletedVatPeriod('quarter', new Date(2027, 7, 10))).toEqual({ year: 2027, index: 2 });
    expect(lastCompletedVatPeriod('year', new Date(2027, 2, 1))).toEqual({ year: 2026, index: 1 });
  });
});

describe('AccountingVatReturnsPageComponent', () => {
  const definition: AccountingVatReturnDefinition = {
    key: 'DE-USTVA',
    name: 'UStVA',
    kind: 'periodic',
    periods: ['month', 'quarter'],
    boxes: [
      { box: '81', label: 'Base 19%', kind: 'base' },
      { box: '39', label: 'Special prepayment', kind: 'manual' },
    ],
    resultBox: '83',
    filingChannel: 'ELSTER',
    dueRule: '10th day after period end',
  };
  let facade: Record<string, unknown> & { load: jest.Mock; mutate: jest.Mock };

  function create() {
    facade = {
      overview$: resource({ features: [{ key: 'DE-USTVA', available: true, missing: [] }], fiscalYears: [] }),
      vatDefinitions$: resource([definition]),
      vatReturns$: resource(),
      vatStatistics$: resource(),
      vatReturn$: resource(),
      mutating$: new BehaviorSubject(false),
      mutationKind$: new BehaviorSubject(null),
      mutationError$: new BehaviorSubject<string | null>(null),
      lastMutation$: new BehaviorSubject(null),
      viewTenantId$: new BehaviorSubject<string | null>(null),
      load: jest.fn(),
      mutate: jest.fn(),
      clear: jest.fn(),
      clearMutation: jest.fn(),
      setViewTenant: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [AccountingVatReturnsPageComponent],
      providers: [
        { provide: AccountingFacade, useValue: facade },
        {
          provide: BillingCapabilitiesFacade,
          useValue: {
            accountingGlobalAccess$: new BehaviorSubject(true),
            viewableTenants$: new BehaviorSubject(['default']),
            loadCapabilities: jest.fn(),
          },
        },
        {
          provide: AdminAccountingService,
          useValue: { downloadVatReturnCsv: jest.fn().mockReturnValue(of(new Blob())) },
        },
        { provide: Router, useValue: { navigate: jest.fn(), navigateByUrl: jest.fn() } },
        { provide: ENVIRONMENT, useValue: { billing: { tenantId: 'default', urls: { restApi: 'http://api' } } } },
      ],
    });

    return TestBed.runInInjectionContext(() => new AccountingVatReturnsPageComponent());
  }

  it('loads overview, definitions, returns and statistics', () => {
    const page = create();

    page.ngOnInit();

    expect(facade.load).toHaveBeenCalledWith({ key: 'overview' });
    expect(facade.load).toHaveBeenCalledWith({ key: 'vatDefinitions' });
    expect(facade.load).toHaveBeenCalledWith({ key: 'vatReturns', params: { limit: 200 } });
    expect(facade.load).toHaveBeenCalledWith({ key: 'vatStatistics' });
  });

  it('computes the selected quarter of the definition', () => {
    const page = create();

    page.setPeriodType('quarter');
    page.year.set(2026);
    page.periodIndex.set(2);
    page.compute();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'computeVatReturn',
      dto: { definitionKey: 'DE-USTVA', periodStart: '2026-04-01', periodEnd: '2026-06-30' },
    });
  });

  it('prefills the VAT payment signed: a refund stays negative', () => {
    const page = create();

    (facade['vatReturn$'] as BehaviorSubject<unknown>).next({
      data: { id: 'v2', status: 'submitted', resultAmount: '-500.00' },
      loading: false,
      error: null,
      loaded: true,
    });
    page.openPay();
    page.pay();

    expect(page.payAmount).toBe(-500);
    expect(facade.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'payVatReturn', id: 'v2', dto: expect.objectContaining({ amount: -500 }) }),
    );
  });

  it('recomputes a draft with the edited manual boxes', () => {
    const page = create();
    const draft = {
      id: 'v1',
      definitionKey: 'DE-USTVA',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      status: 'draft',
      figures: { '81': 1000 },
      details: [],
      manualValues: {},
    } as unknown as AccountingVatReturn;

    (facade['vatReturn$'] as BehaviorSubject<unknown>).next({ data: draft, loading: false, error: null, loaded: true });
    page.manualDraft = { '39': 120 };
    page.recompute();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'computeVatReturn',
      dto: {
        definitionKey: 'DE-USTVA',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        manualValues: { '39': 120 },
      },
    });
  });
});
