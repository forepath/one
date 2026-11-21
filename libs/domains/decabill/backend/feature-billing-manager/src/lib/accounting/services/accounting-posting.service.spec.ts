import { SettlementDocumentType, SettlementSource, SettlementType } from '../../constants/settlement.constants';
import { TaxMode } from '../../constants/tax-mode.constants';
import { DocumentSettlementEntity } from '../../entities/document-settlement.entity';
import { InvoiceCreditDocumentEntity } from '../../entities/invoice-credit-document.entity';
import { InvoiceLineItemEntity } from '../../entities/invoice-line-item.entity';
import { InvoiceEntity } from '../../entities/invoice.entity';
import { SupplierInvoiceLineItemEntity } from '../../entities/supplier-invoice-line-item.entity';
import { SupplierInvoiceEntity } from '../../entities/supplier-invoice.entity';
import { SupplierProfileEntity } from '../../entities/supplier-profile.entity';
import { AccountingAccountRole as R, JournalSourceType, TaxCodeKind } from '../constants/accounting.constants';
import { AccountingAccountEntity } from '../entities/accounting-account.entity';

import type { PostEntryInput } from './accounting-journal.service';
import { AccountingPostingService } from './accounting-posting.service';

const TAX_CODES = [
  {
    id: 'tc-std',
    code: 'OUT_STD',
    kind: TaxCodeKind.OUTPUT,
    rate: '19',
    accountId: 'acc-vat-out-19',
    isActive: true,
    oss: false,
    ecSalesList: false,
  },
  {
    id: 'tc-red',
    code: 'OUT_RED',
    kind: TaxCodeKind.OUTPUT,
    rate: '7',
    accountId: 'acc-vat-out-7',
    isActive: true,
    oss: false,
    ecSalesList: false,
  },
  {
    id: 'tc-rc',
    code: 'OUT_EU_RC',
    kind: TaxCodeKind.EXEMPT,
    rate: '0',
    accountId: null,
    isActive: true,
    oss: false,
    ecSalesList: true,
  },
  {
    id: 'tc-oss',
    code: 'OUT_OSS',
    kind: TaxCodeKind.OUTPUT,
    rate: null,
    accountId: 'acc-vat-oss',
    isActive: true,
    oss: true,
    ecSalesList: false,
  },
  {
    id: 'tc-in',
    code: 'IN_STD',
    kind: TaxCodeKind.INPUT,
    rate: '19',
    accountId: 'acc-vat-in-19',
    isActive: true,
    oss: false,
    ecSalesList: false,
  },
  {
    id: 'tc-in-7',
    code: 'IN_RED',
    kind: TaxCodeKind.INPUT,
    rate: '7',
    accountId: 'acc-vat-in-7',
    isActive: true,
    oss: false,
    ecSalesList: false,
  },
  {
    id: 'tc-rc-eu',
    code: 'RC_EU_SRV',
    kind: TaxCodeKind.REVERSE_CHARGE,
    rate: '19',
    accountId: 'acc-vat-in-rc',
    reverseAccountId: 'acc-vat-out-rc',
    isActive: true,
    oss: false,
    ecSalesList: false,
  },
];

function sumSide(input: PostEntryInput, side: 'debit' | 'credit'): number {
  return Math.round(input.lines.reduce((s, l) => s + (l[side] ?? 0), 0) * 100) / 100;
}

function line(input: PostEntryInput, accountId: string) {
  return input.lines.filter((l) => l.accountId === accountId);
}

describe('AccountingPostingService', () => {
  let rows: Map<unknown, Record<string, unknown>[]>;
  let posted: PostEntryInput[];
  const manager = {
    queryRunner: { isTransactionActive: true },
    query: jest.fn(async (sql: string) => (sql.includes('FROM users') ? [{ tenant_id: 'acme' }] : [])),
    getRepository: jest.fn((entity: unknown) => ({
      findOneOrFail: jest.fn(async ({ where }: { where: { id: string } }) => {
        const found = (rows.get(entity) ?? []).find((r) => r['id'] === where.id);

        if (!found) {
          throw new Error(`not found ${String(where.id)}`);
        }

        return found;
      }),
      findOne: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id ? ((rows.get(entity) ?? []).find((r) => r['id'] === where.id) ?? null) : null,
      ),
      find: jest.fn(async ({ where }: { where: Record<string, string> }) =>
        (rows.get(entity) ?? []).filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)),
      ),
    })),
  };
  const config = {
    isEnabled: jest.fn(() => true),
    getConfig: jest.fn(() => ({ startDate: '2026-01-01', functionalCurrency: 'EUR' })),
  };
  const charts = {
    requireAccountByRole: jest.fn(async (_chart: string, role: R) => ({
      id: `acc-${role}`,
      number: role,
      isActive: true,
    })),
    findTaxCode: jest.fn(async (_chart: string, code: string) => TAX_CODES.find((t) => t.code === code) ?? null),
    listTaxCodes: jest.fn(async () => TAX_CODES),
    findAccountByNumber: jest.fn(async () => null),
    getAccountByRole: jest.fn(),
  };
  const fiscalYears = { resolvePostingTarget: jest.fn(async () => ({ fiscalYear: { chartId: 'chart-1' } })) };
  const journal = {
    findByKey: jest.fn(async () => null),
    post: jest.fn(async (input: PostEntryInput) => {
      posted.push(input);

      return { entry: { id: `entry-${posted.length}` }, created: true };
    }),
    reverse: jest.fn(),
  };
  const fx = {
    convert: jest.fn(async (_amount: number, _currency: string, _date: string) => ({
      rate: 1,
      functionalAmount: 1,
      rateDate: '2026-01-01',
      source: 'identity',
    })),
  };
  const assets = { findBySupplierLines: jest.fn(async () => []), create: jest.fn() };
  const service = new AccountingPostingService(
    {} as never,
    config as never,
    charts as never,
    fiscalYears as never,
    journal as never,
    fx as never,
    assets as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    posted = [];
    rows = new Map();
    rows.set(AccountingAccountEntity, []);
    config.isEnabled.mockReturnValue(true);
    fx.convert.mockResolvedValue({ rate: 1, functionalAmount: 1, rateDate: '2026-01-01', source: 'identity' });
  });

  const invoice = (overrides: Partial<InvoiceEntity> = {}) => ({
    id: 'inv-1',
    userId: 'user-1',
    invoiceNumber: 'INV-2026-00001',
    currency: 'EUR',
    totalGross: 126,
    subtotalNet: 110,
    taxTotal: 16,
    taxMode: TaxMode.DOMESTIC_VAT,
    issuedAt: new Date('2026-03-10T10:00:00Z'),
    buyerVatId: null,
    ...overrides,
  });

  it('books an issued invoice: receivable against revenue and VAT per rate (balanced, tenant dimension)', async () => {
    rows.set(InvoiceLineItemEntity, [
      { invoiceId: 'inv-1', lineNet: 100, lineTax: 19, taxRate: 19 },
      { invoiceId: 'inv-1', lineNet: 10, lineTax: 0.7, taxRate: 7 },
    ]);
    rows.set(InvoiceEntity, [invoice({ totalGross: 129.7, taxTotal: 19.7 })]);

    await service.onInvoiceIssued(manager as never, 'inv-1');

    expect(posted).toHaveLength(1);

    const entry = posted[0];

    expect(entry.sourceType).toBe(JournalSourceType.INVOICE);
    expect(entry.tenantId).toBe('acme');
    expect(sumSide(entry, 'debit')).toBe(sumSide(entry, 'credit'));
    expect(line(entry, `acc-${R.RECEIVABLES}`)[0]).toEqual(
      expect.objectContaining({ debit: 129.7, counterpartyId: 'user-1', openItemId: 'inv-1' }),
    );
    expect(line(entry, `acc-${R.REVENUE_STANDARD}`)[0]).toEqual(
      expect.objectContaining({ credit: 100, taxRole: 'base' }),
    );
    expect(line(entry, `acc-${R.REVENUE_REDUCED}`)[0]).toEqual(expect.objectContaining({ credit: 10 }));
    expect(line(entry, 'acc-vat-out-19')[0]).toEqual(expect.objectContaining({ credit: 19, taxRole: 'tax' }));
    expect(line(entry, 'acc-vat-out-7')[0]).toEqual(expect.objectContaining({ credit: 0.7 }));
  });

  it('books EU reverse-charge revenue with the buyer VAT id and no VAT line', async () => {
    rows.set(InvoiceEntity, [
      invoice({
        taxMode: TaxMode.EU_REVERSE_CHARGE,
        totalGross: 100,
        taxTotal: 0,
        buyerVatId: 'FR123',
        buyerCountry: 'FR',
      }),
    ]);
    rows.set(InvoiceLineItemEntity, [{ invoiceId: 'inv-1', lineNet: 100, lineTax: 0, taxRate: 0 }]);

    await service.onInvoiceIssued(manager as never, 'inv-1');

    const revenue = line(posted[0], `acc-${R.REVENUE_EU_REVERSE_CHARGE}`)[0];

    expect(revenue).toEqual(expect.objectContaining({ credit: 100, euVatId: 'FR123', euCountry: 'FR' }));
    expect(posted[0].lines).toHaveLength(2);
  });

  it('does not book invoices issued before the bookkeeping start (opening items)', async () => {
    rows.set(InvoiceEntity, [invoice({ issuedAt: new Date('2025-12-20T10:00:00Z') })]);
    rows.set(InvoiceLineItemEntity, [{ invoiceId: 'inv-1', lineNet: 100, lineTax: 19, taxRate: 19 }]);

    await service.onInvoiceIssued(manager as never, 'inv-1');

    expect(journal.post).not.toHaveBeenCalled();
  });

  it('books a processor payment to the clearing account and a bank match to the bank', async () => {
    rows.set(InvoiceEntity, [invoice()]);
    rows.set(DocumentSettlementEntity, [
      {
        id: 'set-1',
        documentType: SettlementDocumentType.INVOICE,
        documentId: 'inv-1',
        type: SettlementType.PAYMENT,
        amount: '126',
        occurredAt: new Date('2026-03-12T10:00:00Z'),
        source: SettlementSource.PROCESSOR_WEBHOOK,
        processor: 'stripe',
      },
    ]);

    await service.onSettlementApplied(manager as never, 'set-1');

    expect(line(posted[0], `acc-${R.PROCESSOR_CLEARING}`)[0]).toEqual(expect.objectContaining({ debit: 126 }));
    expect(line(posted[0], `acc-${R.RECEIVABLES}`)[0]).toEqual(
      expect.objectContaining({ credit: 126, openItemId: 'inv-1' }),
    );
  });

  it('books migrated payments from the start date on (they clear receivables of booked invoices)', async () => {
    rows.set(InvoiceEntity, [invoice({ totalGross: 119, taxTotal: 19 })]);
    rows.set(DocumentSettlementEntity, [
      {
        id: 'set-mig',
        documentType: SettlementDocumentType.INVOICE,
        documentId: 'inv-1',
        type: SettlementType.PAYMENT,
        amount: '119',
        occurredAt: new Date('2026-03-20T10:00:00Z'),
        source: SettlementSource.MIGRATION,
      },
    ]);

    await service.onSettlementApplied(manager as never, 'set-mig');

    expect(line(posted[0], `acc-${R.RECEIVABLES}`)[0]).toEqual(
      expect.objectContaining({ credit: 119, openItemId: 'inv-1' }),
    );
    expect(line(posted[0], `acc-${R.BANK}`)[0]).toEqual(expect.objectContaining({ debit: 119 }));
  });

  it('books FX differences between invoice and payment rates', async () => {
    rows.set(InvoiceEntity, [invoice({ currency: 'USD', totalGross: 110, taxTotal: 0 })]);
    rows.set(DocumentSettlementEntity, [
      {
        id: 'set-1',
        documentType: SettlementDocumentType.INVOICE,
        documentId: 'inv-1',
        type: SettlementType.PAYMENT,
        amount: '110',
        occurredAt: new Date('2026-04-01T10:00:00Z'),
        source: SettlementSource.MANUAL,
      },
    ]);
    // Invoice booked at 1.10 USD/EUR (100 EUR), paid at 1.00 (110 EUR) → 10 EUR exchange gain.
    fx.convert.mockImplementation(async (_a: number, _c: string, date: string) => ({
      rate: date === '2026-03-10' ? 1.1 : 1,
      functionalAmount: 0,
      rateDate: date,
      source: 'ecb',
    }));

    await service.onSettlementApplied(manager as never, 'set-1');

    const entry = posted[0];

    expect(line(entry, `acc-${R.BANK}`)[0]).toEqual(expect.objectContaining({ debit: 110 }));
    expect(line(entry, `acc-${R.RECEIVABLES}`)[0]).toEqual(expect.objectContaining({ credit: 100 }));
    expect(line(entry, `acc-${R.FX_GAIN}`)[0]).toEqual(expect.objectContaining({ credit: 10 }));
  });

  it('corrects output VAT proportionally on write-offs (§ 17 UStG)', async () => {
    rows.set(InvoiceEntity, [invoice({ totalGross: 119, taxTotal: 19, subtotalNet: 100 })]);
    rows.set(InvoiceLineItemEntity, [{ invoiceId: 'inv-1', lineNet: 100, lineTax: 19, taxRate: 19 }]);
    rows.set(DocumentSettlementEntity, [
      {
        id: 'set-w',
        documentType: SettlementDocumentType.INVOICE,
        documentId: 'inv-1',
        type: SettlementType.WRITE_OFF,
        amount: '119',
        occurredAt: new Date('2026-06-01T10:00:00Z'),
        source: SettlementSource.MANUAL,
      },
    ]);

    await service.onSettlementApplied(manager as never, 'set-w');

    expect(line(posted[0], `acc-${R.BAD_DEBT}`)[0]).toEqual(expect.objectContaining({ debit: 100, taxRole: 'base' }));
    expect(line(posted[0], 'acc-vat-out-19')[0]).toEqual(expect.objectContaining({ debit: 19 }));
    expect(line(posted[0], `acc-${R.RECEIVABLES}`)[0]).toEqual(expect.objectContaining({ credit: 119 }));
  });

  it('skips credit settlements (the credit note books itself) and books credit transfers once', async () => {
    rows.set(InvoiceEntity, [invoice()]);
    rows.set(DocumentSettlementEntity, [
      {
        id: 's-credit',
        documentType: SettlementDocumentType.INVOICE,
        documentId: 'inv-1',
        type: SettlementType.CREDIT,
        amount: '10',
        occurredAt: new Date(),
        source: SettlementSource.CREDIT_DOCUMENT,
      },
      {
        id: 's-out',
        documentType: SettlementDocumentType.INVOICE,
        documentId: 'inv-0',
        type: SettlementType.CREDIT_TRANSFER_OUT,
        amount: '10',
        occurredAt: new Date(),
        source: SettlementSource.CUSTOMER_CREDIT,
      },
      {
        id: 's-in',
        documentType: SettlementDocumentType.INVOICE,
        documentId: 'inv-1',
        type: SettlementType.CREDIT_TRANSFER_IN,
        amount: '10',
        occurredAt: new Date('2026-05-01T10:00:00Z'),
        source: SettlementSource.CUSTOMER_CREDIT,
        relatedDocumentId: 'inv-0',
      },
    ]);

    await service.onSettlementApplied(manager as never, 's-credit');
    await service.onSettlementApplied(manager as never, 's-out');
    await service.onSettlementApplied(manager as never, 's-in');

    expect(posted).toHaveLength(1);
    expect(posted[0].lines).toEqual([
      expect.objectContaining({ accountId: `acc-${R.RECEIVABLES}`, debit: 10, openItemId: 'inv-0' }),
      expect.objectContaining({ accountId: `acc-${R.RECEIVABLES}`, credit: 10, openItemId: 'inv-1' }),
    ]);
  });

  it('books a credit note with the snapshotted rate against the invoice open item', async () => {
    rows.set(InvoiceEntity, [invoice()]);
    rows.set(InvoiceCreditDocumentEntity, [
      {
        id: 'cr-1',
        invoiceId: 'inv-1',
        documentNumber: 'INV-2026-00001-CN-x',
        creditNet: 50,
        creditGross: 59.5,
        creditTax: 9.5,
        taxRate: 19,
        withdrawnAt: new Date('2026-03-20T10:00:00Z'),
      },
    ]);

    await service.onCreditDocumentCreated(manager as never, 'cr-1');

    expect(line(posted[0], `acc-${R.REVENUE_STANDARD}`)[0]).toEqual(expect.objectContaining({ debit: 50 }));
    expect(line(posted[0], 'acc-vat-out-19')[0]).toEqual(expect.objectContaining({ debit: 9.5 }));
    expect(line(posted[0], `acc-${R.RECEIVABLES}`)[0]).toEqual(
      expect.objectContaining({ credit: 59.5, openItemId: 'inv-1' }),
    );
  });

  it('books a foreign-currency credit note at the invoice rate and keeps the original amounts', async () => {
    rows.set(InvoiceEntity, [invoice({ currency: 'USD' })]);
    rows.set(InvoiceCreditDocumentEntity, [
      {
        id: 'cr-usd',
        invoiceId: 'inv-1',
        documentNumber: 'CN-USD',
        creditNet: 100,
        creditGross: 119,
        creditTax: 19,
        taxRate: 19,
        withdrawnAt: new Date('2026-04-20T10:00:00Z'),
      },
    ]);
    // Invoice day 1.25 USD/EUR, credit day 1.00: the credit must use the invoice rate (no residual on the item).
    fx.convert.mockImplementation(async (_a: number, _c: string, date: string) => ({
      rate: date === '2026-03-10' ? 1.25 : 1,
      functionalAmount: 0,
      rateDate: date,
      source: 'ecb',
    }));

    await service.onCreditDocumentCreated(manager as never, 'cr-usd');

    expect(line(posted[0], `acc-${R.RECEIVABLES}`)[0]).toEqual(
      expect.objectContaining({ credit: 95.2, originalAmount: -119, originalCurrency: 'USD' }),
    );
    expect(line(posted[0], `acc-${R.REVENUE_STANDARD}`)[0]).toEqual(
      expect.objectContaining({ debit: 80, originalAmount: 100, originalCurrency: 'USD' }),
    );
  });

  it('keeps original amount and currency on converted invoice lines (even at a 1.0 rate)', async () => {
    rows.set(InvoiceEntity, [invoice({ currency: 'USD', totalGross: 119, taxTotal: 19, subtotalNet: 100 })]);
    rows.set(InvoiceLineItemEntity, [{ invoiceId: 'inv-1', lineNet: 100, lineTax: 19, taxRate: 19 }]);

    await service.onInvoiceIssued(manager as never, 'inv-1');

    expect(line(posted[0], `acc-${R.RECEIVABLES}`)[0]).toEqual(
      expect.objectContaining({ debit: 119, originalAmount: 119, originalCurrency: 'USD' }),
    );
  });

  it('corrects input VAT per rate with tax codes on a supplier cash discount', async () => {
    rows.set(SupplierInvoiceEntity, [
      {
        id: 'si-2',
        supplierId: 'sup-1',
        invoiceNumber: 'SUP-2',
        currency: 'EUR',
        totalGross: 226,
        subtotalNet: 200,
        taxTotal: 26,
        taxMode: TaxMode.DOMESTIC_VAT,
        issueDate: '2026-03-05',
      },
    ]);
    rows.set(SupplierProfileEntity, [{ id: 'sup-1', tenantId: 'acme', defaultExpenseAccountNumber: null }]);
    rows.set(SupplierInvoiceLineItemEntity, [
      { id: 'l1', invoiceId: 'si-2', lineNet: 100, lineTax: 19, taxRate: 19 },
      { id: 'l2', invoiceId: 'si-2', lineNet: 100, lineTax: 7, taxRate: 7 },
    ]);
    rows.set(DocumentSettlementEntity, [
      {
        id: 'set-d',
        documentType: SettlementDocumentType.SUPPLIER_INVOICE,
        documentId: 'si-2',
        type: SettlementType.DISCOUNT,
        amount: '4.52',
        occurredAt: new Date('2026-03-12T10:00:00Z'),
        source: SettlementSource.MANUAL,
      },
    ]);

    await service.onSettlementApplied(manager as never, 'set-d');

    const taxLines = posted[0].lines.filter((l) => l.taxRole === 'tax');

    // 4.52 split 119:107 → 2.38 (0.38 VAT 19 %) and 2.14 (0.14 VAT 7 %), each with its input tax code.
    expect(taxLines.map((l) => [l.credit, l.taxRate, Boolean(l.taxCodeId)])).toEqual([
      [0.38, 19, true],
      [0.14, 7, true],
    ]);
    expect(posted[0].lines.reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0)).toBeCloseTo(0);
  });

  it('books EU supplier services with reverse charge (input and output VAT, payable net)', async () => {
    rows.set(SupplierInvoiceEntity, [
      {
        id: 'si-1',
        supplierId: 'sup-1',
        invoiceNumber: 'AWS-1',
        currency: 'EUR',
        totalGross: 200,
        subtotalNet: 200,
        taxTotal: 0,
        taxMode: TaxMode.EU_REVERSE_CHARGE,
        issueDate: '2026-03-05',
        supplierVatId: 'IE999',
      },
    ]);
    rows.set(SupplierProfileEntity, [{ id: 'sup-1', tenantId: 'acme', defaultExpenseAccountNumber: null }]);
    rows.set(SupplierInvoiceLineItemEntity, [
      {
        id: 'l1',
        invoiceId: 'si-1',
        lineNet: 200,
        lineTax: 0,
        taxRate: 0,
        description: 'Cloud',
        capitalizeAsAsset: false,
      },
    ]);

    await service.onSupplierInvoiceIssued(manager as never, 'si-1');

    const entry = posted[0];

    expect(line(entry, `acc-${R.EXPENSE_REVERSE_CHARGE_EU}`)[0]).toEqual(
      expect.objectContaining({ debit: 200, taxRole: 'base' }),
    );
    expect(line(entry, 'acc-vat-in-rc')[0]).toEqual(expect.objectContaining({ debit: 38, taxRole: 'reverse_tax' }));
    expect(line(entry, 'acc-vat-out-rc')[0]).toEqual(expect.objectContaining({ credit: 38, taxRole: 'tax' }));
    expect(line(entry, `acc-${R.PAYABLES}`)[0]).toEqual(
      expect.objectContaining({ credit: 200, counterpartyId: 'sup-1', openItemId: 'si-1' }),
    );
  });

  it('never throws: failures roll back to the savepoint and are recorded as posting issues', async () => {
    rows.set(InvoiceEntity, [invoice({ taxMode: TaxMode.DOMESTIC_VAT })]);
    rows.set(InvoiceLineItemEntity, [{ invoiceId: 'inv-1', lineNet: 100, lineTax: 16, taxRate: 16 }]);

    await expect(service.onInvoiceIssued(manager as never, 'inv-1')).resolves.toBeUndefined();

    const sql = manager.query.mock.calls.map((c) => String(c[0]));

    expect(sql.some((q) => q.startsWith('ROLLBACK TO SAVEPOINT'))).toBe(true);
    expect(sql.some((q) => q.includes('INSERT INTO billing_accounting_posting_issues'))).toBe(true);
    expect(journal.post).not.toHaveBeenCalled();
  });

  it('keeps the idempotency lookup and the issue bookkeeping inside savepoints (billing transaction stays usable)', async () => {
    journal.findByKey.mockRejectedValueOnce(new Error('lookup failed'));
    manager.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO billing_accounting_posting_issues')) {
        throw new Error('issue table locked');
      }

      return sql.includes('FROM users') ? [{ tenant_id: 'acme' }] : [];
    });

    try {
      await expect(service.onInvoiceIssued(manager as never, 'inv-1')).resolves.toBeUndefined();

      const sql = manager.query.mock.calls.map(
        (c) => String(c[0]).split(' ')[0] + (String(c[0]).includes('posting_issues') ? ' issue' : ''),
      );

      // lookup savepoint → rolled back; issue savepoint → rolled back as well: nothing failed outside a savepoint.
      expect(sql).toEqual(['SAVEPOINT', 'ROLLBACK', 'SAVEPOINT', 'INSERT issue', 'ROLLBACK']);
    } finally {
      manager.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM users') ? [{ tenant_id: 'acme' }] : [],
      );
    }
  });

  it('does nothing while accounting is disabled', async () => {
    config.isEnabled.mockReturnValue(false);

    await service.onInvoiceIssued(manager as never, 'inv-1');

    expect(manager.getRepository).not.toHaveBeenCalled();
  });
});
