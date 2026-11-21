import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  AccountingFacade,
  AdminAccountingService,
  BillingCapabilitiesFacade,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { BehaviorSubject, of } from 'rxjs';

import { ThemeService } from '../theme.service';

import { AccountingJournalPageComponent } from './accounting-journal-page.component';

const empty = () => new BehaviorSubject({ data: null, loading: false, error: null, loaded: false });

describe('AccountingJournalPageComponent', () => {
  let facade: Record<string, unknown> & {
    load: jest.Mock;
    mutate: jest.Mock;
    clearMutation: jest.Mock;
    currentFiscalYear$: BehaviorSubject<unknown>;
  };

  function create(query: Record<string, string> = {}) {
    facade = {
      journalStatistics$: empty(),
      journal$: empty(),
      entry$: empty(),
      byLink$: empty(),
      accountDirectory$: empty(),
      taxCodes$: empty(),
      viewTenantId$: new BehaviorSubject<string | null>(null),
      accountIndex$: new BehaviorSubject(new Map()),
      currentFiscalYear$: new BehaviorSubject<unknown>(null),
      mutating$: new BehaviorSubject(false),
      mutationError$: new BehaviorSubject<string | null>(null),
      lastMutation$: new BehaviorSubject(null),
      load: jest.fn(),
      mutate: jest.fn(),
      clear: jest.fn(),
      clearMutation: jest.fn(),
      setViewTenant: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [AccountingJournalPageComponent],
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
          useValue: {
            downloadReceipt: jest.fn().mockReturnValue(of(new Blob())),
            getReferenceLabel: jest.fn().mockReturnValue(of({ label: 'INV-2026-00001' })),
          },
        },
        { provide: Router, useValue: { navigate: jest.fn(), navigateByUrl: jest.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: new BehaviorSubject(convertToParamMap(query)),
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
        { provide: ThemeService, useValue: { isDarkMode: signal(false) } },
        { provide: ENVIRONMENT, useValue: { billing: { tenantId: 'default', urls: { restApi: 'http://api' } } } },
      ],
    });

    return TestBed.runInInjectionContext(() => new AccountingJournalPageComponent());
  }

  it('loads overview, accounts, statistics and the first journal page', () => {
    const page = create();

    page.ngOnInit();
    TestBed.tick();

    const requests = facade.load.mock.calls.map(([request]) => request);

    expect(requests).toContainEqual({ key: 'overview' });
    expect(requests).toContainEqual({ key: 'accountDirectory' });
    expect(requests).toContainEqual(expect.objectContaining({ key: 'journalStatistics' }));
    expect(requests).toContainEqual(
      expect.objectContaining({ key: 'journal', params: expect.objectContaining({ offset: 0 }) }),
    );
  });

  it('loads the tax codes of the current fiscal year chart', () => {
    create();
    facade.currentFiscalYear$.next({ id: 'fy', chartId: 'chart-1' });
    TestBed.tick();

    expect(facade.load).toHaveBeenCalledWith({ key: 'taxCodes', chartId: 'chart-1' });
  });

  it('submits a balanced manual entry', () => {
    const page = create();

    page.openManualEntry();
    page.manualDocumentDate = '2026-03-01';
    page.manualDescription = 'Office rent';
    page.manualLines = [
      { accountNumber: '4210', debit: '1190', credit: null, taxCode: 'IN_STD', description: '', costCenter: '' },
      { accountNumber: '1200', debit: null, credit: 1190, taxCode: '', description: '', costCenter: '' },
    ];

    expect(page.isBalanced()).toBe(true);

    page.submitManualEntry();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'createManualEntry',
      dto: {
        documentDate: '2026-03-01',
        documentNumber: undefined,
        description: 'Office rent',
        tenantId: undefined,
        lines: [
          {
            accountNumber: '4210',
            debit: 1190,
            credit: undefined,
            taxCode: 'IN_STD',
            description: undefined,
            costCenter: undefined,
          },
          {
            accountNumber: '1200',
            debit: undefined,
            credit: 1190,
            taxCode: undefined,
            description: undefined,
            costCenter: undefined,
          },
        ],
        links: undefined,
      },
    });
  });

  it('refuses lines with both or no amounts', () => {
    const page = create();

    page.openManualEntry();
    page.manualDescription = 'Broken';
    page.manualLines = [
      { accountNumber: '4210', debit: 10, credit: 10, taxCode: '', description: '', costCenter: '' },
      { accountNumber: '1200', debit: null, credit: null, taxCode: '', description: '', costCenter: '' },
    ];
    page.submitManualEntry();

    expect(facade.mutate).not.toHaveBeenCalled();
  });

  it('shows the bookings of a linked document and links new bookings to it', () => {
    const page = create({ linkType: 'invoice', targetId: 'inv-1' });

    TestBed.tick();

    expect(facade.load).toHaveBeenCalledWith({ key: 'byLink', linkType: 'invoice', targetId: 'inv-1' });
    expect(page.buildManualEntry().links).toEqual([{ linkType: 'invoice', targetId: 'inv-1', role: 'related' }]);
  });

  it('names the linked document by its number instead of its id', () => {
    const page = create({ linkType: 'invoice', targetId: 'inv-1' });

    TestBed.tick();

    expect(page.linkContextLabel()).toBe('INV-2026-00001');
  });

  it('shows counterparties and link targets by label, keeping external processor ids', () => {
    const page = create();

    expect(page.lineCounterparty({ counterpartyType: 'customer', counterpartyId: 'u-1' } as never)).toBe('');
    expect(
      page.lineCounterparty({
        counterpartyType: 'customer',
        counterpartyId: 'u-1',
        counterpartyLabel: 'Acme (CUS-000001)',
      } as never),
    ).toBe('Acme (CUS-000001)');
    expect(page.linkLabel({ linkType: 'invoice', targetId: 'inv-1', targetLabel: 'INV-1' } as never)).toBe('INV-1');
    expect(
      page.linkLabel({ linkType: 'invoice', targetId: 'inv-1', targetLabel: 'INV-1', label: 'Mine' } as never),
    ).toBe('Mine');
    expect(page.linkLabel({ linkType: 'processor_transaction', targetId: 'txn_1' } as never)).toBe('txn_1');
  });

  it('shows the tenant of an entry by its display name', () => {
    const page = create();

    (facade['entry$'] as BehaviorSubject<unknown>).next({
      data: { id: 'e1', entryNumber: 7, tenantId: 'decabill', lines: [], links: [] },
      loading: false,
      error: null,
      loaded: true,
    });

    expect(page.entryItems().find((item) => item.key === 'tenant')?.value).toBe('Decabill');
  });

  it('ignores unknown link types', () => {
    const page = create({ linkType: 'nope', targetId: 'x' });

    expect(page.linkContext()).toBeNull();
  });
});
