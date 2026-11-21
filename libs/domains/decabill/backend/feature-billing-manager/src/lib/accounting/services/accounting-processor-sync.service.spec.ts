import { SettlementDocumentType } from '../../constants/settlement.constants';
import { DocumentSettlementEntity } from '../../entities/document-settlement.entity';
import type { ProcessorBalanceTransaction } from '../../payment-processors/payment-processor.interface';
import { AccountingAccountRole as R } from '../constants/accounting.constants';
import { AccountingBankImportEntity } from '../entities/accounting-bank-import.entity';
import { AccountingBankTransactionEntity } from '../entities/accounting-bank-transaction.entity';
import { AccountingFinancialAccountEntity } from '../entities/accounting-financial-account.entity';

import { AccountingProcessorSyncService, parseSyncCursor } from './accounting-processor-sync.service';

describe('AccountingProcessorSyncService', () => {
  let insertKeys: Set<string>;
  let inserts: unknown[][];
  let settlements: Array<{ externalId: string; documentType: SettlementDocumentType; type?: string }>;
  let accountRow: Record<string, unknown>;
  const accountRepo = { find: jest.fn(async () => [accountRow]), update: jest.fn() };
  const importRepo = {
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn(async (row: Record<string, unknown>) => ({ ...row, id: 'imp-1' })),
    update: jest.fn(),
  };
  const settlementRepo = {
    findOne: jest.fn(
      async ({ where }: { where: Array<{ documentType: string; externalId: string; type?: { value: string[] } }> }) =>
        settlements.find((s) =>
          where.some(
            (w) =>
              w.documentType === s.documentType &&
              w.externalId === s.externalId &&
              (!w.type || w.type.value.includes(s.type ?? 'payment')),
          ),
        ) ?? null,
    ),
  };
  const txRepo = { update: jest.fn() };
  const dataSource = {
    manager: { marker: 'manager' },
    getRepository: (entity: unknown) => {
      if (entity === AccountingFinancialAccountEntity) return accountRepo;

      if (entity === AccountingBankImportEntity) return importRepo;

      if (entity === DocumentSettlementEntity) return settlementRepo;

      if (entity === AccountingBankTransactionEntity) return txRepo;

      throw new Error('unexpected repository');
    },
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (!sql.includes('INSERT INTO billing_accounting_bank_transactions')) {
        return [];
      }

      // ON CONFLICT (financial_account_id, dedupe_key, dedupe_ordinal) DO NOTHING
      const key = `${String(params[0])}|${String(params[11])}`;

      if (insertKeys.has(key)) {
        return [];
      }

      insertKeys.add(key);
      inserts.push(params);

      return [{ id: `bt-${inserts.length}` }];
    }),
  };
  const config = { isEnabled: jest.fn(() => true), getConfig: jest.fn(() => ({ startDate: '2026-01-01' })) };
  const processor: { listBalanceTransactions?: jest.Mock } = { listBalanceTransactions: jest.fn() };
  const processors = { getProcessor: jest.fn(() => processor) };
  const reconciliation = { apply: jest.fn(), suggestAndAutoMatch: jest.fn(async () => ({ suggested: 1, matched: 0 })) };
  const charts = {
    requireAccountByRole: jest.fn(async (_chart: string, role: R) => ({
      number: role === R.PAYMENT_FEES ? '4970' : '1360',
    })),
  };
  const fiscalYears = { resolvePostingTarget: jest.fn(async () => ({ fiscalYear: { chartId: 'chart-1' } })) };
  const service = new AccountingProcessorSyncService(
    dataSource as never,
    config as never,
    processors as never,
    reconciliation as never,
    charts as never,
    fiscalYears as never,
  );
  const item = (overrides: Partial<ProcessorBalanceTransaction> = {}): ProcessorBalanceTransaction => ({
    id: 'txn_1',
    type: 'charge',
    amount: 100,
    fee: 1.75,
    net: 98.25,
    currency: 'EUR',
    created: new Date('2026-03-10T10:00:00Z'),
    sourceId: 'ch_1',
    paymentIntentId: 'pi_1',
    ...overrides,
  });
  const page = (items: ProcessorBalanceTransaction[], hasMore = false) => ({ items, hasMore });
  const account = () => accountRow as unknown as AccountingFinancialAccountEntity;

  beforeEach(() => {
    jest.clearAllMocks();
    insertKeys = new Set();
    inserts = [];
    settlements = [];
    accountRow = {
      id: 'fa-stripe',
      name: 'Stripe',
      kind: 'processor',
      processor: 'stripe',
      currency: 'EUR',
      tenantId: 'acme',
      syncCursor: null,
      isActive: true,
    };
    processor.listBalanceTransactions = jest.fn(async () => page([]));
    processors.getProcessor.mockImplementation(() => processor);
    config.isEnabled.mockReturnValue(true);
    reconciliation.apply.mockResolvedValue(undefined);
  });

  it('books a charge as gross + fee lines; a webhook-settled charge is only marked reconciled', async () => {
    settlements = [{ externalId: 'pi_1', documentType: SettlementDocumentType.INVOICE }];
    processor.listBalanceTransactions!.mockResolvedValueOnce(page([item()]));

    const imported = await service.syncAccount(account());

    expect(imported).toBe(2);
    expect(inserts.map((p) => [p[5], p[7], p[8], p[10]])).toEqual([
      ['100.00', 'charge', 'txn_1', 'api:txn_1:gross'],
      ['-1.75', 'charge fee', 'txn_1:fee', 'api:txn_1:fee'],
    ]);
    expect(inserts[0][2]).toBe('acme');
    expect(inserts[0][3]).toBe('2026-03-10');
    expect(JSON.parse(inserts[0][9] as string)[0].processor).toEqual(
      expect.objectContaining({ provider: 'stripe', chargeId: 'ch_1', gross: '100.00', fee: '1.75', net: '98.25' }),
    );
    // Gross: settled by webhook → no second booking.
    expect(txRepo.update).toHaveBeenCalledWith('bt-1', expect.objectContaining({ matchStatus: 'matched' }));
    // Fee: booked to payment fees.
    expect(reconciliation.apply).toHaveBeenCalledTimes(1);
    expect(reconciliation.apply).toHaveBeenCalledWith(
      'bt-2',
      [expect.objectContaining({ type: 'account', accountNumber: '4970', amount: -1.75 })],
      null,
    );
    expect(importRepo.update).toHaveBeenCalledWith(
      'imp-1',
      expect.objectContaining({ status: 'completed', transactionCount: 2, matchedCount: 2 }),
    );
  });

  it('settles a charge against the invoice from payment metadata when no webhook settlement exists', async () => {
    processor.listBalanceTransactions!.mockResolvedValueOnce(page([item({ fee: 0, invoiceId: 'inv-1' })]));

    await service.syncAccount(account());

    expect(inserts).toHaveLength(1);
    expect(reconciliation.apply).toHaveBeenCalledWith('bt-1', [{ type: 'invoice', id: 'inv-1', amount: 100 }], null);
    expect(txRepo.update).not.toHaveBeenCalled();
  });

  it('does not treat the original payment settlement as the settled refund (same payment intent)', async () => {
    settlements.push({ documentType: SettlementDocumentType.INVOICE, externalId: 'pi_shared', type: 'payment' });
    processor.listBalanceTransactions!.mockResolvedValueOnce(
      page([
        item({
          id: 'txn_r2',
          type: 'refund',
          amount: -40,
          fee: 0,
          net: -40,
          sourceId: 're_2',
          paymentIntentId: 'pi_shared',
        }),
      ]),
    );

    await service.syncAccount(account());

    expect(txRepo.update).not.toHaveBeenCalled();
    expect(reconciliation.suggestAndAutoMatch).toHaveBeenCalledWith(['bt-1']);
  });

  it('leaves an unsettled refund to the suggestion engine (never settles negative amounts against invoices)', async () => {
    processor.listBalanceTransactions!.mockResolvedValueOnce(
      page([
        item({
          id: 'txn_r',
          type: 'refund',
          amount: -50,
          fee: 0,
          net: -50,
          sourceId: 're_1',
          paymentIntentId: undefined,
          invoiceId: 'inv-1',
        }),
      ]),
    );

    await service.syncAccount(account());

    expect(inserts.map((p) => [p[5], p[7]])).toEqual([['-50.00', 'refund']]);
    expect(reconciliation.apply).not.toHaveBeenCalled();
    expect(reconciliation.suggestAndAutoMatch).toHaveBeenCalledWith(['bt-1']);
    expect(importRepo.update).toHaveBeenCalledWith('imp-1', expect.objectContaining({ matchedCount: 0 }));
  });

  it('moves payouts to cash in transit and books standalone processor fees to payment fees', async () => {
    processor.listBalanceTransactions!.mockResolvedValueOnce(
      page([
        item({
          id: 'po_1',
          type: 'payout',
          amount: -500,
          fee: 0,
          net: -500,
          sourceId: 'po_1',
          paymentIntentId: undefined,
          created: new Date('2026-03-11T10:00:00Z'),
        }),
        item({
          id: 'txn_fee',
          type: 'stripe_fee',
          amount: -2,
          fee: 0,
          net: -2,
          sourceId: undefined,
          paymentIntentId: undefined,
          created: new Date('2026-03-12T10:00:00Z'),
        }),
      ]),
    );

    await service.syncAccount(account());

    expect(charts.requireAccountByRole).toHaveBeenCalledWith('chart-1', R.CASH_IN_TRANSIT);
    expect(reconciliation.apply).toHaveBeenCalledWith(
      'bt-1',
      [expect.objectContaining({ accountNumber: '1360', amount: -500, description: 'Processor payout' })],
      null,
    );
    expect(reconciliation.apply).toHaveBeenCalledWith(
      'bt-2',
      [expect.objectContaining({ accountNumber: '4970', amount: -2, description: 'Processor fee' })],
      null,
    );
  });

  it('is idempotent: a second run with the same movements inserts and reconciles nothing', async () => {
    processor.listBalanceTransactions!.mockResolvedValue(page([item()]));

    expect(await service.syncAccount(account())).toBe(2);

    const keys = inserts.map((p) => p[11]);

    reconciliation.apply.mockClear();
    txRepo.update.mockClear();

    expect(await service.syncAccount(account())).toBe(0);
    expect(inserts).toHaveLength(2);
    expect(dataSource.query).toHaveBeenCalledTimes(4);
    expect((dataSource.query.mock.calls[2][1] as unknown[])[11]).toBe(keys[0]);
    expect(reconciliation.apply).not.toHaveBeenCalled();
    expect(txRepo.update).not.toHaveBeenCalled();
  });

  it('pages from the stored cursor, ignores other currencies and advances the cursor to the newest movement', async () => {
    accountRow['syncCursor'] = String(Date.parse('2026-03-01T00:00:00Z'));
    processor
      .listBalanceTransactions!.mockResolvedValueOnce(
        page(
          [item({ id: 'b', created: new Date('2026-03-12T10:00:00Z') }), item({ id: 'usd', currency: 'USD' })],
          true,
        ),
      )
      .mockResolvedValueOnce(page([item({ id: 'a', fee: 0, created: new Date('2026-03-11T10:00:00Z') })]));

    await service.syncAccount(account());

    // One second of overlap (the API filters by whole seconds); duplicates are skipped by the dedupe key.
    expect(processor.listBalanceTransactions).toHaveBeenNthCalledWith(1, {
      createdAfter: new Date('2026-02-28T23:59:59Z'),
      startingAfter: undefined,
      limit: 100,
    });
    expect(processor.listBalanceTransactions).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ startingAfter: 'usd' }),
    );
    // Sorted oldest first, USD movement skipped.
    expect(inserts.map((p) => p[8])).toEqual(['a', 'b', 'b:fee']);
    expect(accountRepo.update).toHaveBeenCalledWith(
      'fa-stripe',
      expect.objectContaining({ syncCursor: String(Date.parse('2026-03-12T10:00:00Z')) }),
    );
  });

  it('starts at the accounting start date without a cursor and only touches lastSyncedAt when nothing is new', async () => {
    await service.syncAccount(account());

    expect(processor.listBalanceTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ createdAfter: new Date('2025-12-31T23:59:59Z') }),
    );
    expect(accountRepo.update).toHaveBeenCalledWith('fa-stripe', {
      syncCursor: String(Date.parse('2026-01-01T00:00:00Z')),
      lastSyncedAt: expect.any(Date),
    });
    expect(importRepo.save).not.toHaveBeenCalled();
  });

  it('keeps the cursor and resumes after the oldest listed movement when the page budget runs out', async () => {
    accountRow['syncCursor'] = String(Date.parse('2026-03-01T00:00:00Z'));
    processor.listBalanceTransactions!.mockImplementation(async (params) =>
      page([item({ id: `p-${params.startingAfter ?? 'first'}`, created: new Date('2026-03-12T10:00:00Z') })], true),
    );

    await service.syncAccount(account());

    expect(processor.listBalanceTransactions).toHaveBeenCalledTimes(20);
    const cursor = String(
      (accountRepo.update.mock.calls.find((c) => (c[1] as Record<string, unknown>)['syncCursor']) ?? [])[1]?.[
        'syncCursor'
      ],
    );
    const [ms, resumeAfter, newest] = cursor.split('|');

    expect(Number(ms)).toBe(Date.parse('2026-03-01T00:00:00Z'));
    expect(resumeAfter).toMatch(/^p-/);
    expect(Number(newest)).toBe(Date.parse('2026-03-12T10:00:00Z'));
    expect(parseSyncCursor(cursor, '2026-01-01')).toEqual({
      cursorMs: Number(ms),
      resumeAfter,
      pendingNewestMs: Number(newest),
    });
  });

  it('skips processors without a balance API or unknown processors', async () => {
    delete processor.listBalanceTransactions;

    expect(await service.syncAccount(account())).toBe(0);

    processors.getProcessor.mockImplementation(() => {
      throw new Error('unknown processor');
    });

    expect(await service.syncAccount(account())).toBe(0);
    expect(await service.syncAccount({ ...account(), processor: null } as AccountingFinancialAccountEntity)).toBe(0);
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(accountRepo.update).not.toHaveBeenCalled();
  });

  it('reports API failures per account and leaves the cursor untouched', async () => {
    accountRow['syncCursor'] = '1772323200000';
    processor.listBalanceTransactions!.mockRejectedValueOnce(new Error('Stripe unavailable'));

    const results = await service.syncAll();

    expect(accountRepo.find).toHaveBeenCalledWith({ where: { kind: 'processor', isActive: true } });
    expect(results).toEqual([{ accountId: 'fa-stripe', imported: 0, error: 'Stripe unavailable' }]);
    expect(accountRepo.update).not.toHaveBeenCalled();
    expect(importRepo.save).not.toHaveBeenCalled();
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('falls back to suggestions when applying a reconciliation fails', async () => {
    processor.listBalanceTransactions!.mockResolvedValueOnce(page([item({ fee: 0, invoiceId: 'inv-1' })]));
    reconciliation.apply.mockRejectedValueOnce(new Error('invoice already paid'));

    expect(await service.syncAccount(account())).toBe(1);
    expect(reconciliation.suggestAndAutoMatch).toHaveBeenCalledWith(['bt-1']);
    expect(importRepo.update).toHaveBeenCalledWith('imp-1', expect.objectContaining({ matchedCount: 0 }));
  });

  it('does nothing while accounting is disabled', async () => {
    config.isEnabled.mockReturnValue(false);

    expect(await service.syncAll()).toEqual([]);
    expect(accountRepo.find).not.toHaveBeenCalled();
  });
});
