import {
  AccountingAccountRole as R,
  CounterpartyType,
  JournalEntryKind,
  JournalSourceType,
} from '../constants/accounting.constants';

import { AccountingCatchUpService } from './accounting-catch-up.service';
import type { PostEntryInput } from './accounting-journal.service';

describe('AccountingCatchUpService', () => {
  let documentRows: (sql: string) => Array<Record<string, string>>;
  let openingRows: (sql: string) => Record<string, unknown>[];
  const manager = {
    query: jest.fn(async (sql: string, _params?: unknown[]) => openingRows(sql)),
  };
  const dataSource = {
    query: jest.fn(async (sql: string, _params?: unknown[]) => documentRows(sql)),
    transaction: jest.fn(async (cb: (m: typeof manager) => Promise<unknown>) => await cb(manager)),
  };
  const config = {
    isEnabled: jest.fn(() => true),
    getConfig: jest.fn(() => ({ startDate: '2026-01-01' })),
  };
  const posting = {
    onInvoiceIssued: jest.fn(async (_manager: unknown, _id: string) => undefined),
    onInvoiceVoided: jest.fn(async (_manager: unknown, _id: string) => undefined),
    onCreditDocumentCreated: jest.fn(async (_manager: unknown, _id: string) => undefined),
    onSettlementApplied: jest.fn(async (_manager: unknown, _id: string) => undefined),
    onSupplierInvoiceIssued: jest.fn(async (_manager: unknown, _id: string) => undefined),
    onSupplierInvoiceVoided: jest.fn(async (_manager: unknown, _id: string) => undefined),
  };
  const journal = { post: jest.fn(async (_input: PostEntryInput) => ({ entry: { id: 'e-1' }, created: true })) };
  const fiscalYears = {
    ensureYearForDate: jest.fn(async () => ({ id: 'fy-2026', startDate: '2026-01-01', chartId: 'c1' })),
  };
  const charts = { requireAccountByRole: jest.fn(async (_chart: string, role: R) => ({ id: `acc-${role}` })) };
  const fx = {
    convert: jest.fn(async (_amount: number, currency: string, _date: string) => ({
      rate: currency === 'USD' ? 1.25 : 1,
    })),
  };
  let service: AccountingCatchUpService;

  beforeEach(() => {
    jest.clearAllMocks();
    documentRows = () => [];
    openingRows = () => [];
    config.isEnabled.mockReturnValue(true);
    fiscalYears.ensureYearForDate.mockResolvedValue({ id: 'fy-2026', startDate: '2026-01-01', chartId: 'c1' });
    service = new AccountingCatchUpService(
      dataSource as never,
      config as never,
      posting as never,
      journal as never,
      fiscalYears as never,
      charts as never,
      fx as never,
    );
  });

  it('does nothing while accounting is disabled', async () => {
    config.isEnabled.mockReturnValue(false);

    await expect(service.run()).resolves.toBeNull();

    expect(dataSource.query).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('posts every document without an automatic entry, each in its own transaction, and reports the counts', async () => {
    documentRows = (sql) => {
      if (sql.includes('FROM billing_invoices i') && sql.includes(":issued'")) {
        return [{ id: 'inv-1' }, { id: 'inv-2' }];
      }

      if (sql.includes('FROM billing_invoices i') && sql.includes(":voided'")) {
        return [{ id: 'inv-3' }];
      }

      if (sql.includes('FROM billing_invoice_credit_documents')) {
        return [{ id: 'cr-1' }];
      }

      if (sql.includes('FROM billing_supplier_invoices s') && sql.includes(":issued'")) {
        return [{ id: 'si-1' }];
      }

      if (sql.includes('FROM billing_supplier_invoices s') && sql.includes(":voided'")) {
        return [{ id: 'si-2' }];
      }

      if (sql.includes('FROM billing_document_settlements')) {
        return [{ id: 'set-1' }, { id: 'set-2' }];
      }

      return [];
    };

    const result = await service.run();

    expect(result).toEqual({
      openingItems: 0,
      invoicesIssued: 2,
      invoicesVoided: 1,
      creditDocuments: 1,
      supplierInvoicesIssued: 1,
      supplierInvoicesVoided: 1,
      settlements: 2,
      retriedIssues: 0,
    });
    expect(posting.onInvoiceIssued.mock.calls).toEqual([
      [manager, 'inv-1'],
      [manager, 'inv-2'],
    ]);
    expect(posting.onInvoiceVoided).toHaveBeenCalledWith(manager, 'inv-3');
    expect(posting.onCreditDocumentCreated).toHaveBeenCalledWith(manager, 'cr-1');
    expect(posting.onSupplierInvoiceIssued).toHaveBeenCalledWith(manager, 'si-1');
    expect(posting.onSupplierInvoiceVoided).toHaveBeenCalledWith(manager, 'si-2');
    expect(posting.onSettlementApplied.mock.calls.map((c) => c[1])).toEqual(['set-1', 'set-2']);
    // One transaction for the opening items, one per backfilled document.
    expect(dataSource.transaction).toHaveBeenCalledTimes(1 + 8);
  });

  it('selects only documents from the bookkeeping start that have no entry yet (idempotent re-runs)', async () => {
    await service.run();

    const selects = dataSource.query.mock.calls
      .map((c) => ({ sql: String(c[0]), params: c[1] }))
      .filter((q) => !q.sql.includes('billing_accounting_posting_issues'));

    expect(selects).toHaveLength(6);

    for (const { sql, params } of selects) {
      // Start date plus the accounting timezone: documents are compared by their local booking date.
      expect(params).toEqual(['2026-01-01', 'Europe/Berlin']);
      expect(sql).not.toContain("interval '1 day'");
      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key =');
    }

    // Credit settlements / outgoing credit transfers are booked by their counterpart. Migrated settlements after the
    // start are booked too: they clear receivables of documents booked from the start (or opening items).
    const settlements = selects.find((s) => s.sql.includes('billing_document_settlements'))!.sql;

    expect(settlements).toContain("s.type NOT IN ('credit', 'credit_transfer_out')");
    expect(settlements).not.toContain("s.source <> 'migration'");
    // Zero-value documents have nothing to book and must not be re-selected forever.
    expect(settlements).toContain('s.amount <> 0');
    expect(selects.find((s) => s.sql.includes(":issued'") && s.sql.includes('billing_invoices'))!.sql).toContain(
      'i.total_gross <> 0',
    );
    expect(posting.onInvoiceIssued).not.toHaveBeenCalled();
  });

  it('retries open posting issues through the matching posting handler', async () => {
    documentRows = (sql) =>
      sql.includes('FROM billing_accounting_posting_issues')
        ? [
            { source_type: 'invoice', source_id: 'inv-9', source_event: 'issued' },
            { source_type: 'settlement', source_id: 'set-9', source_event: 'payment' },
            { source_type: 'manual', source_id: 'x', source_event: 'created' },
          ]
        : [];

    await expect(service.run()).resolves.toEqual(expect.objectContaining({ retriedIssues: 2 }));
    expect(posting.onInvoiceIssued).toHaveBeenCalledWith(manager, 'inv-9');
    expect(posting.onSettlementApplied).toHaveBeenCalledWith(manager, 'set-9');
  });

  it('keeps backfilling documents when the opening item takeover fails', async () => {
    jest
      .spyOn(service, 'takeOverOpeningItems')
      .mockRejectedValueOnce(new Error('No account with role opening_balance_receivables'));
    documentRows = (sql) =>
      sql.includes('FROM billing_invoices i') && sql.includes(":issued'") ? [{ id: 'inv-1' }] : [];

    await expect(service.run()).resolves.toEqual(expect.objectContaining({ openingItems: 0, invoicesIssued: 1 }));
    expect(posting.onInvoiceIssued).toHaveBeenCalledWith(expect.anything(), 'inv-1');
  });

  it('relies on the posting service to record failures; a rejected posting does not leave the run locked', async () => {
    documentRows = (sql) =>
      sql.includes('FROM billing_invoices i') && sql.includes(":issued'") ? [{ id: 'inv-1' }] : [];
    posting.onInvoiceIssued.mockRejectedValueOnce(new Error('boom'));

    await expect(service.run()).rejects.toThrow('boom');

    // The `running` guard is released in `finally`; the next run retries the still-unbooked document.
    await expect(service.run()).resolves.toEqual(expect.objectContaining({ invoicesIssued: 1 }));
    expect(posting.onInvoiceIssued).toHaveBeenCalledTimes(2);
  });

  it('skips a run while another one is still in progress', async () => {
    let release!: () => void;

    fiscalYears.ensureYearForDate.mockImplementationOnce(
      () =>
        new Promise<{ id: string; startDate: string; chartId: string }>((resolve) => {
          release = () => resolve({ id: 'fy-2026', startDate: '2026-01-01', chartId: 'c1' });
        }),
    );

    const first = service.run();

    await Promise.resolve();
    await expect(service.run()).resolves.toBeNull();

    release();
    await expect(first).resolves.not.toBeNull();
  });

  it('takes over open items from before the start as per-item opening balances against the carry-forward accounts', async () => {
    openingRows = (sql) => {
      if (sql.includes('FROM billing_invoices i')) {
        return [
          { id: 'inv-old', user_id: 'u-1', balance: '119.00', number: 'INV-2025-00042', tenant_id: 'acme' },
          { id: 'inv-credit', user_id: 'u-2', balance: '-10.5', number: null, tenant_id: null },
        ];
      }

      if (sql.includes('FROM billing_supplier_invoices s')) {
        return [{ id: 'si-old', supplier_id: 'sup-1', balance: '50', number: 'AWS-7', tenant_id: 'acme' }];
      }

      return [];
    };

    await expect(service.takeOverOpeningItems()).resolves.toBe(3);

    const posted = journal.post.mock.calls.map((c) => c[0]);

    expect(posted).toHaveLength(3);
    expect(posted[0]).toEqual(
      expect.objectContaining({
        documentDate: '2026-01-01',
        kind: JournalEntryKind.OPENING,
        sourceType: JournalSourceType.OPENING_BALANCE,
        idempotencyKey: 'opening_balance:inv-old:receivable',
        fiscalYearId: 'fy-2026',
        tenantId: 'acme',
      }),
    );
    expect(posted[0].lines).toEqual([
      expect.objectContaining({
        accountId: `acc-${R.RECEIVABLES}`,
        debit: 119,
        counterpartyType: CounterpartyType.CUSTOMER,
        counterpartyId: 'u-1',
        openItemId: 'inv-old',
      }),
      expect.objectContaining({ accountId: `acc-${R.OPENING_BALANCE_RECEIVABLES}`, credit: 119 }),
    ]);
    // Customer credit balance (overpaid invoice) flips the sides.
    expect(posted[1].lines).toEqual([
      expect.objectContaining({ accountId: `acc-${R.RECEIVABLES}`, credit: 10.5, openItemId: 'inv-credit' }),
      expect.objectContaining({ accountId: `acc-${R.OPENING_BALANCE_RECEIVABLES}`, debit: 10.5 }),
    ]);
    expect(posted[2]).toEqual(
      expect.objectContaining({
        idempotencyKey: 'opening_balance:si-old:payable',
        description: expect.stringContaining('AWS-7'),
      }),
    );
    expect(posted[2].lines).toEqual([
      expect.objectContaining({
        accountId: `acc-${R.PAYABLES}`,
        credit: 50,
        counterpartyType: CounterpartyType.SUPPLIER,
        counterpartyId: 'sup-1',
        openItemId: 'si-old',
      }),
      expect.objectContaining({ accountId: `acc-${R.OPENING_BALANCE_PAYABLES}`, debit: 50 }),
    ]);

    for (const entry of posted) {
      expect(entry.lines.reduce((s, l) => s + (l.debit ?? 0), 0)).toBe(
        entry.lines.reduce((s, l) => s + (l.credit ?? 0), 0),
      );
    }
  });

  it('only selects open items that were not taken over before', async () => {
    await service.takeOverOpeningItems();

    const sql = manager.query.mock.calls.map((c) => String(c[0]));

    expect(sql).toHaveLength(2);
    expect(sql[0]).toContain("e.idempotency_key = 'opening_balance:' || i.id || ':receivable'");
    expect(sql[1]).toContain("e.idempotency_key = 'opening_balance:' || s.id || ':payable'");
    // Nothing open → no role lookups, no postings.
    expect(charts.requireAccountByRole).not.toHaveBeenCalled();
    expect(journal.post).not.toHaveBeenCalled();
  });

  it('reconstructs the opening amount from the settlement history and converts it at the document rate', async () => {
    openingRows = (sql) =>
      sql.includes('FROM billing_invoices')
        ? [
            {
              id: 'inv-usd',
              user_id: 'u-1',
              balance: '125.00',
              number: 'INV-USD',
              tenant_id: 'acme',
              currency: 'USD',
              doc_date: '2025-12-20',
            },
          ]
        : [];

    await service.takeOverOpeningItems();

    const [customerSql, customerParams] = manager.query.mock.calls[0] as [string, unknown[]];

    // Open at the start, not today: gross minus settlements dated before the start (booking time zone); documents
    // voided after the start are still open at the start.
    expect(customerSql).toContain('i.total_gross - COALESCE((');
    expect(customerSql).toContain("((st.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date < $1::date");
    expect(customerSql).toContain("((i.issued_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date < $1::date");
    expect(customerSql).toContain("i.status <> 'void' OR");
    expect(customerParams).toEqual(['2026-01-01', 'Europe/Berlin']);
    expect(fx.convert).toHaveBeenCalledWith(1, 'USD', '2025-12-20', manager);
    expect((journal.post.mock.calls[0] as unknown[])[0]).toEqual(
      expect.objectContaining({
        lines: expect.arrayContaining([expect.objectContaining({ accountId: `acc-${R.RECEIVABLES}`, debit: 100 })]),
      }),
    );
  });

  it('skips items that were already settled completely before the start', async () => {
    openingRows = (sql) =>
      sql.includes('FROM billing_invoices')
        ? [
            {
              id: 'inv-paid',
              user_id: 'u-1',
              balance: '0.0000',
              number: 'X',
              tenant_id: 'acme',
              currency: 'EUR',
              doc_date: '2025-12-01',
            },
          ]
        : [];

    await expect(service.takeOverOpeningItems()).resolves.toBe(0);
    expect(journal.post).not.toHaveBeenCalled();
  });

  it('takes nothing over when the first fiscal year starts after the bookkeeping start', async () => {
    fiscalYears.ensureYearForDate.mockResolvedValueOnce({ id: 'fy-x', startDate: '2026-02-01', chartId: 'c1' });

    await expect(service.takeOverOpeningItems()).resolves.toBe(0);

    expect(manager.query).not.toHaveBeenCalled();
    expect(journal.post).not.toHaveBeenCalled();
  });
});
