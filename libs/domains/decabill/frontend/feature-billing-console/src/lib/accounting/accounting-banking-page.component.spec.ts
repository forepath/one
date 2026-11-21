import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  AccountingFacade,
  AdminAccountingService,
  BillingCapabilitiesFacade,
  type AccountingBankTransaction,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { BehaviorSubject, of } from 'rxjs';

import {
  AccountingBankingPageComponent,
  buildBankImportUpload,
  buildMatchInput,
} from './accounting-banking-page.component';

const resource = (data: unknown = null) =>
  new BehaviorSubject<{ data: unknown; loading: boolean; error: string | null; loaded: boolean }>({
    data,
    loading: false,
    error: null,
    loaded: data !== null,
  });

describe('buildBankImportUpload', () => {
  const file = new File(['x'], 'statement.csv');

  it('omits automatic options', () => {
    expect(
      buildBankImportUpload({
        file,
        format: 'auto',
        csvSource: '',
        encoding: 'auto',
        qifDateFormat: 'auto',
        financialAccountId: '',
      }),
    ).toEqual({ file });
  });

  it('passes the CSV preset, encoding and target account', () => {
    expect(
      buildBankImportUpload({
        file,
        format: 'csv',
        csvSource: 'preset:sparkasse-camt',
        encoding: 'windows-1252',
        qifDateFormat: 'DMY',
        financialAccountId: 'fa1',
      }),
    ).toEqual({
      file,
      format: 'csv',
      csvPreset: 'sparkasse-camt',
      encoding: 'windows-1252',
      financialAccountId: 'fa1',
    });
  });
});

describe('buildMatchInput', () => {
  it('maps document and account targets with absolute amounts', () => {
    expect(
      buildMatchInput(
        [
          {
            type: 'invoice',
            id: ' inv-1 ',
            number: 'INV-1',
            accountNumber: '',
            taxCode: '',
            description: '',
            amount: 80,
          },
          {
            type: 'account',
            id: '',
            number: '',
            accountNumber: '4970',
            taxCode: 'IN_STD',
            description: 'Fee',
            amount: -20,
          },
        ],
        true,
      ),
    ).toEqual({
      targets: [
        { type: 'invoice', id: 'inv-1', amount: 80 },
        { type: 'account', accountNumber: '4970', amount: 20, taxCode: 'IN_STD', description: 'Fee' },
      ],
      learn: true,
    });
  });

  it('sends a typed document number when no suggestion picked the id', () => {
    expect(
      buildMatchInput(
        [
          {
            type: 'supplier_invoice',
            id: '',
            number: ' SINV-2026-00001 ',
            accountNumber: '',
            taxCode: '',
            description: '',
            amount: 50,
          },
        ],
        false,
      ).targets,
    ).toEqual([{ type: 'supplier_invoice', number: 'SINV-2026-00001', amount: 50 }]);
  });
});

describe('AccountingBankingPageComponent', () => {
  let facade: Record<string, unknown> & { load: jest.Mock; mutate: jest.Mock };
  const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };

  function create() {
    facade = {
      overview$: resource(),
      bankStatistics$: resource(),
      transactions$: resource(),
      imports$: resource(),
      importDetail$: resource(),
      financialAccounts$: resource([]),
      csvPresets$: resource([]),
      csvMappings$: resource([]),
      matchRules$: resource([]),
      suggestions$: resource([]),
      taxCodes$: resource([]),
      currentFiscalYear$: new BehaviorSubject({ id: 'fy', chartId: 'chart-1' }),
      mutating$: new BehaviorSubject(false),
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
      imports: [AccountingBankingPageComponent],
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
          useValue: { downloadImportFile: jest.fn().mockReturnValue(of(new Blob())) },
        },
        { provide: Router, useValue: router },
        { provide: ENVIRONMENT, useValue: { billing: { tenantId: 'default', urls: { restApi: 'http://api' } } } },
      ],
    });

    return TestBed.runInInjectionContext(() => new AccountingBankingPageComponent());
  }

  it('loads the banking resources and the first transactions page', () => {
    const page = create();

    page.ngOnInit();
    TestBed.tick();

    expect(facade.load).toHaveBeenCalledWith({ key: 'financialAccounts' });
    expect(facade.load).toHaveBeenCalledWith({ key: 'imports', limit: 100 });
    expect(facade.load).toHaveBeenCalledWith({ key: 'csvPresets' });
    expect(facade.load).toHaveBeenCalledWith({ key: 'csvMappings' });
    expect(facade.load).toHaveBeenCalledWith({ key: 'matchRules' });
    expect(facade.load).toHaveBeenCalledWith(expect.objectContaining({ key: 'bankStatistics' }));
    expect(facade.load).toHaveBeenCalledWith({
      key: 'transactions',
      params: expect.objectContaining({ limit: 25, offset: 0 }),
    });
  });

  it('matches a transaction with the learn flag', () => {
    const page = create();
    const tx = { id: 'tx1', amount: '-100.00', currency: 'EUR', matchStatus: 'unmatched' } as AccountingBankTransaction;

    page.openMatch(tx);

    expect(facade.load).toHaveBeenCalledWith({ key: 'suggestions', transactionId: 'tx1' });
    expect(facade.load).toHaveBeenCalledWith({ key: 'taxCodes', chartId: 'chart-1' });

    page.patchTarget(0, { id: 'sup-inv-1' });
    page.matchLearn = true;
    page.submitMatch();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'matchTransaction',
      transactionId: 'tx1',
      dto: { targets: [{ type: 'supplier_invoice', id: 'sup-inv-1', amount: 100 }], learn: true },
    });
  });

  it('refuses a match whose amounts do not add up', () => {
    const page = create();

    page.openMatch({ id: 'tx2', amount: 50, currency: 'EUR', matchStatus: 'unmatched' } as AccountingBankTransaction);
    page.patchTarget(0, { id: 'inv-1', amount: 40 });
    page.submitMatch();

    expect(page.matchValid()).toBe(false);
    expect(facade.mutate).not.toHaveBeenCalled();
  });

  it('links transaction bookings to the journal', () => {
    const page = create();

    page.onTxAction({ id: 'tx3', matchStatus: 'matched' } as AccountingBankTransaction, 'bookings');

    expect(router.navigate).toHaveBeenCalledWith(['/administration/accounting/journal'], {
      queryParams: { linkType: 'bank_transaction', targetId: 'tx3' },
    });
  });
});
