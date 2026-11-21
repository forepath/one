import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  AccountingFacade,
  AdminAccountingService,
  BillingCapabilitiesFacade,
  type AccountingAccount,
  type AccountingTaxCode,
  type AccountingTrialBalanceRow,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { BehaviorSubject, of } from 'rxjs';

import { AccountingAccountsPageComponent } from './accounting-accounts-page.component';

const resource = <T>(data: T | null = null) =>
  new BehaviorSubject({ data, loading: false, error: null as string | null, loaded: data !== null });
const tbRow = (
  accountId: string,
  type: AccountingTrialBalanceRow['type'],
  debit: number,
  credit: number,
  closing: number,
): AccountingTrialBalanceRow => ({
  accountId,
  number: accountId,
  name: accountId,
  type,
  statementPosition: null,
  opening: 0,
  debit,
  credit,
  closing,
});

describe('AccountingAccountsPageComponent', () => {
  const account = {
    id: 'a1',
    chartId: 'c1',
    number: '1200',
    name: 'Bank',
    type: 'asset',
    isActive: true,
    isAutomatic: false,
  } as AccountingAccount;
  let facade: Record<string, unknown> & { load: jest.Mock; mutate: jest.Mock; clearMutation: jest.Mock };

  function create() {
    TestBed.configureTestingModule({
      imports: [AccountingAccountsPageComponent],
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
        { provide: AdminAccountingService, useValue: { downloadExport: jest.fn().mockReturnValue(of(new Blob())) } },
        { provide: Router, useValue: { navigate: jest.fn(), navigateByUrl: jest.fn() } },
        { provide: ENVIRONMENT, useValue: { billing: { tenantId: 'default', urls: { restApi: 'http://api' } } } },
      ],
    });

    return TestBed.runInInjectionContext(() => new AccountingAccountsPageComponent());
  }

  beforeEach(() => {
    facade = {
      charts$: resource([{ id: 'c1', code: 'SKR03', name: 'SKR 03' }]),
      accounts$: resource([account]),
      taxCodes$: resource<AccountingTaxCode[]>([]),
      trialBalance$: resource<AccountingTrialBalanceRow[]>([
        tbRow('a1', 'asset', 100, 40, 60),
        tbRow('a2', 'revenue', 0, 100, -100),
      ]),
      ledger$: resource(),
      currentFiscalYear$: new BehaviorSubject(null),
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
  });

  it('loads charts and the trial balance, and accounts / tax codes of a selected chart', () => {
    const page = create();

    page.ngOnInit();
    page.selectChart('c1');

    expect(facade.load).toHaveBeenCalledWith({ key: 'charts' });
    expect(facade.load).toHaveBeenCalledWith(expect.objectContaining({ key: 'trialBalance' }));
    expect(facade.load).toHaveBeenCalledWith({ key: 'accounts', chartId: 'c1' });
    expect(facade.load).toHaveBeenCalledWith({ key: 'taxCodes', chartId: 'c1' });
  });

  it('creates an account in the selected chart', () => {
    const page = create();

    page.selectChart('c1');
    page.openAccountModal();
    page.accountForm = { ...page.accountForm, number: '4930', name: 'Office supplies', type: 'expense' };
    page.submitAccount();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'createAccount',
      chartId: 'c1',
      dto: expect.objectContaining({ number: '4930', name: 'Office supplies', type: 'expense', role: null }),
    });
  });

  it('deactivates and deletes accounts from the row menu', () => {
    const page = create();

    page.onAccountAction(account, 'deactivate');
    page.onAccountAction(account, 'delete');
    page.confirmDelete();

    expect(facade.mutate).toHaveBeenCalledWith({ kind: 'updateAccount', accountId: 'a1', dto: { isActive: false } });
    expect(facade.mutate).toHaveBeenCalledWith({ kind: 'deleteAccount', accountId: 'a1' });
  });

  it('opens the ledger of an account for the trial balance range', () => {
    const page = create();

    page.openLedger(account);

    expect(facade.load).toHaveBeenCalledWith({
      key: 'ledger',
      params: expect.objectContaining({ accountId: 'a1', limit: 100, offset: 0 }),
    });
  });

  it('sums the trial balance', () => {
    const page = create();

    expect(page.trialTotals()).toEqual(
      expect.objectContaining({ debit: 100, credit: 140, closing: -40, withBalance: 2 }),
    );
    expect(page.balanceChart()).not.toBeNull();
  });
});
