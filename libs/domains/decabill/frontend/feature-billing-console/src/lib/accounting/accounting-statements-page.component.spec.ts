import { TestBed } from '@angular/core/testing';
import {
  AccountingFacade,
  AdminAccountingService,
  BillingCapabilitiesFacade,
  type AccountingOverview,
  type AccountingStatementNode,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { BehaviorSubject, of } from 'rxjs';

import { AccountingStatementsPageComponent, flattenStatementNodes } from './accounting-statements-page.component';

const resource = <T>(data: T | null = null) => ({ data, loading: false, error: null, loaded: data !== null });

describe('AccountingStatementsPageComponent', () => {
  const overview = {
    profile: { exports: ['datev', 'gdpdu', 'journal_csv'], hasCashBasis: true },
    features: [
      { key: 'gdpdu', available: true, missing: [] },
      { key: 'fec', available: false, missing: ['BILLING_SIREN'] },
    ],
  } as unknown as AccountingOverview;
  let facade: {
    overview$: BehaviorSubject<unknown>;
    statement$: BehaviorSubject<unknown>;
    viewTenantId$: BehaviorSubject<string | null>;
    load: jest.Mock;
  };
  let globalAccess$: BehaviorSubject<boolean>;
  const service = { downloadExport: jest.fn().mockReturnValue(of(new Blob())) };

  function create() {
    facade = {
      overview$: new BehaviorSubject<unknown>(resource(overview)),
      statement$: new BehaviorSubject<unknown>(resource()),
      viewTenantId$: new BehaviorSubject<string | null>(null),
      load: jest.fn(),
    };
    globalAccess$ = new BehaviorSubject(true);

    TestBed.configureTestingModule({
      imports: [AccountingStatementsPageComponent],
      providers: [
        { provide: AccountingFacade, useValue: facade },
        {
          provide: BillingCapabilitiesFacade,
          useValue: {
            accountingGlobalAccess$: globalAccess$,
            viewableTenants$: new BehaviorSubject(['default']),
            loadCapabilities: jest.fn(),
          },
        },
        { provide: AdminAccountingService, useValue: service },
        { provide: ENVIRONMENT, useValue: { billing: { tenantId: 'default', urls: { restApi: 'http://api' } } } },
      ],
    });

    return TestBed.runInInjectionContext(() => new AccountingStatementsPageComponent());
  }

  it('loads the overview and the default P&L statement', () => {
    const page = create();

    page.ngOnInit();

    expect(facade.load).toHaveBeenCalledWith({ key: 'overview' });
    expect(facade.load).toHaveBeenCalledWith({
      key: 'statement',
      params: { kind: 'profit_and_loss', from: page.from, to: page.to },
    });
  });

  it('reloads on kind change', () => {
    const page = create();

    page.onKindChange('balance_sheet');

    expect(facade.load).toHaveBeenLastCalledWith({
      key: 'statement',
      params: { kind: 'balance_sheet', from: page.from, to: page.to },
    });
  });

  it('offers CSV exports always and statutory ones from the profile', () => {
    const page = create();

    expect(page.exportKinds()).toEqual(['journal_csv', 'trial_balance_csv', 'gdpdu']);
  });

  it('disables statutory exports unless all tenants are viewed', () => {
    const page = create();

    expect(page.exportDisabledReason('journal_csv')).toBeNull();
    expect(page.exportDisabledReason('gdpdu')).toContain('All tenants');
    expect(page.exportDisabledReason('fec')).toContain('BILLING_SIREN');

    facade.viewTenantId$.next('all');
    expect(page.exportDisabledReason('gdpdu')).toBeNull();

    globalAccess$.next(false);
    expect(page.exportDisabledReason('gdpdu')).not.toBeNull();
  });

  it('downloads an export for the viewed tenant', async () => {
    const page = create();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    URL.createObjectURL = jest.fn(() => 'blob:x');
    URL.revokeObjectURL = jest.fn();
    facade.viewTenantId$.next('all');
    await page.downloadExport('gdpdu');

    expect(service.downloadExport).toHaveBeenCalledWith('gdpdu', { from: page.from, to: page.to }, 'all');
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('flattens nested positions with optional accounts', () => {
    const nodes: AccountingStatementNode[] = [
      {
        code: 'A',
        label: 'Revenue',
        amount: 100,
        accounts: [],
        children: [
          {
            code: 'A1',
            label: 'Sales',
            amount: 100,
            accounts: [{ number: '8400', name: 'Sales 19%', amount: 100 }],
            children: [],
          },
        ],
      },
    ];

    expect(flattenStatementNodes(nodes, false).map((r) => [r.code, r.level, r.group])).toEqual([
      ['A', 0, true],
      ['A1', 1, false],
    ]);
    expect(flattenStatementNodes(nodes, true).map((r) => r.type)).toEqual(['node', 'node', 'account']);
  });
});
