import { runWithTenantId } from '@forepath/shared/backend';
import { FileStorageScope } from '@forepath/shared/backend/util-file-storage';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Brackets, FindOperator, In, IsNull } from 'typeorm';

import { JournalEntryKind, JournalLinkRole, JournalSourceType } from '../constants/accounting.constants';
import { AccountingBankImportEntity } from '../entities/accounting-bank-import.entity';
import { AccountingBankTransactionEntity } from '../entities/accounting-bank-transaction.entity';
import { AccountingCsvMappingEntity } from '../entities/accounting-csv-mapping.entity';
import { AccountingFinancialAccountEntity } from '../entities/accounting-financial-account.entity';
import { AccountingJournalEntryEntity } from '../entities/accounting-journal-entry.entity';
import { AccountingPostingIssueEntity } from '../entities/accounting-posting-issue.entity';
import {
  assertGlobalAccounting,
  resolveAccountingScope,
  type AccountingViewScope,
} from '../utils/accounting-scope.util';

import { AccountingAdminService } from './accounting-admin.service';
import type { PostEntryInput } from './accounting-journal.service';

function queryBuilder(result: [unknown[], number]) {
  const qb: Record<string, jest.Mock> = {};

  for (const method of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'take', 'skip']) {
    qb[method] = jest.fn(() => qb);
  }

  qb['getManyAndCount'] = jest.fn(async () => result);

  return qb;
}

describe('AccountingAdminService', () => {
  const tenantScope: AccountingViewScope = { tenantFilter: 'acme', requestTenantId: 'acme', global: false };
  const globalAll: AccountingViewScope = { tenantFilter: null, requestTenantId: 'acme', global: true };
  const globalViewingOther: AccountingViewScope = { tenantFilter: 'other', requestTenantId: 'acme', global: true };
  const entries: Record<string, Record<string, unknown>> = {
    'e-acme': { id: 'e-acme', tenantId: 'acme', entryNumber: 1, postingDate: '2026-03-10' },
    'e-other': { id: 'e-other', tenantId: 'other', entryNumber: 2, postingDate: '2026-03-11' },
  };
  let posted: PostEntryInput[];
  let journalQb: ReturnType<typeof queryBuilder>;
  let txQb: ReturnType<typeof queryBuilder>;
  let financialAccounts: Array<Record<string, unknown>>;
  let bankTransactions: Array<Record<string, unknown>>;
  const financialAccountRepo = {
    // Honors `where` (object or OR-array); the only FindOperator used here is IsNull().
    find: jest.fn(async (options: { where?: Record<string, unknown> | Array<Record<string, unknown>> } = {}) => {
      const clauses = options.where ? (Array.isArray(options.where) ? options.where : [options.where]) : null;

      return clauses
        ? financialAccounts.filter((a) =>
            clauses.some((c) =>
              Object.entries(c).every(([k, v]) => (v instanceof FindOperator ? a[k] == null : a[k] === v)),
            ),
          )
        : financialAccounts;
    }),
    findOne: jest.fn(
      async ({ where }: { where: { id: string } }) => financialAccounts.find((a) => a['id'] === where.id) ?? null,
    ),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn(async (row: Record<string, unknown>) => ({ id: 'fa-new', ...row })),
  };
  const postingIssueRepo = { count: jest.fn(async () => 3), findAndCount: jest.fn(async () => [[], 0]) };
  const importRepo = { findAndCount: jest.fn(async () => [[], 0]) };
  const csvMappingRepo = {
    find: jest.fn(async () => []),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };
  const manager = { marker: 'manager' };
  const dataSource = {
    getRepository: (entity: unknown) => {
      if (entity === AccountingJournalEntryEntity) return { createQueryBuilder: () => journalQb };

      if (entity === AccountingBankTransactionEntity) {
        return {
          createQueryBuilder: () => txQb,
          findOne: jest.fn(
            async ({ where }: { where: { id: string } }) => bankTransactions.find((t) => t['id'] === where.id) ?? null,
          ),
        };
      }

      if (entity === AccountingFinancialAccountEntity) return financialAccountRepo;

      if (entity === AccountingPostingIssueEntity) return postingIssueRepo;

      if (entity === AccountingBankImportEntity) return importRepo;

      if (entity === AccountingCsvMappingEntity) return csvMappingRepo;

      throw new Error('unexpected repository');
    },
    transaction: jest.fn(async (run: (m: unknown) => unknown) => await run(manager)),
    query: jest.fn(async (_sql: string, _params: unknown[]): Promise<unknown[]> => []),
  };
  const config = {
    getConfig: jest.fn(() => ({
      enabled: true,
      country: 'DE',
      functionalCurrency: 'EUR',
      defaultChartTemplate: 'skr03',
      method: 'accrual',
      vatBasis: 'invoice',
      startDate: '2026-01-01',
      fiscalYearStartMonth: 1,
      vatReturnPeriod: 'monthly',
      profile: {
        country: 'DE',
        name: 'Germany',
        templates: [],
        vatReturns: [
          {
            key: 'ustva',
            name: 'UStVA',
            kind: 'periodic',
            periods: ['monthly'],
            filingChannel: 'elster',
            filingUrl: null,
            dueRule: '10th',
          },
        ],
        exports: ['datev', 'xaf', 'gdpdu', 'sie'],
        cashBasis: undefined,
        retention: { booksYears: 10, vouchersYears: 10 },
        mandatoryChart: false,
      },
    })),
    getFeatureAvailability: jest.fn(() => [
      { key: 'ustva', available: true, missing: [] },
      { key: 'datev', available: true, missing: [] },
      { key: 'xaf', available: true, missing: [] },
      { key: 'gdpdu', available: false, missing: ['BILLING_ISSUER_NAME'] },
      { key: 'sie', available: true, missing: [] },
    ]),
  };
  const charts = {
    findAccountByNumber: jest.fn(async (_chart: string, number: string) =>
      number === '9999' ? null : { id: `acc-${number}` },
    ),
    findTaxCode: jest.fn(async (_chart: string, code: string) =>
      code === 'IN_STD' ? { id: 'tc-in', rate: '19', accountId: 'acc-vat-in' } : null,
    ),
  };
  const fiscalYears = {
    listYears: jest.fn(async () => [{ id: 'fy-2026' }]),
    resolvePostingTarget: jest.fn(async () => ({ fiscalYear: { chartId: 'chart-1', name: '2026' } })),
  };
  const journal = {
    getEntry: jest.fn(async (id: string) => {
      if (id === 'e-new') {
        return { id, tenantId: posted[posted.length - 1]?.tenantId ?? null, entryNumber: 3, postingDate: '2026-03-12' };
      }

      if (!entries[id]) {
        throw new NotFoundException('Journal entry not found');
      }

      return entries[id];
    }),
    listLinks: jest.fn(async () => []),
    post: jest.fn(async (input: PostEntryInput) => {
      posted.push(input);

      return { entry: { id: 'e-new', entryNumber: 3, total: 119 }, created: true };
    }),
    reverse: jest.fn(async () => ({ entry: { id: 'e-new' } })),
    addLink: jest.fn(async () => ({ id: 'link-1' })),
    removeLink: jest.fn(),
  };
  const reports = {
    journalSeries: jest.fn(async () => [
      { bucket: '2026-03-01', entries: 3, volume: 100.1, manual: 1 },
      { bucket: '2026-04-01', entries: 1, volume: 0.2, manual: 0 },
    ]),
    resultSeries: jest.fn(async () => [{ month: '2026-03', revenue: 1000, expenses: 400.5 }]),
  };
  const reconciliation = {
    suggest: jest.fn(async () => []),
    statusCounts: jest.fn(async (): Promise<Array<{ status: string; count: number }>> => []),
  };
  const auditLog = { log: jest.fn() };
  const fileStorage = {
    writeAccountingReceiptFile: jest.fn(),
    readAccountingReceiptFile: jest.fn(async () => Buffer.from('%PDF')),
  };
  const storedFileRegistry = { registerFromBuffer: jest.fn(async () => ({ id: 'sf-1' })) };
  const references = {
    labels: jest.fn(async (): Promise<Map<string, string>> => new Map()),
    resolve: jest.fn(async (_type: string, input: string) => input),
  };
  const service = new AccountingAdminService(
    dataSource as never,
    config as never,
    charts as never,
    fiscalYears as never,
    journal as never,
    reports as never,
    reconciliation as never,
    auditLog as never,
    fileStorage as never,
    storedFileRegistry as never,
    references as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    posted = [];
    journalQb = queryBuilder([[{ id: 'e1', lines: [{ lineNo: 2 }, { lineNo: 1 }] }], 1]);
    txQb = queryBuilder([[{ id: 'bt-1', raw: 'secret raw line' }], 1]);
    financialAccounts = [
      {
        id: 'fa-1',
        tenantId: 'acme',
        name: 'Main',
        currency: 'EUR',
        lastClosingBalance: '100.50',
        lastClosingDate: '2026-03-31',
      },
      {
        id: 'fa-other',
        tenantId: 'other',
        name: 'Other',
        currency: 'EUR',
        lastClosingBalance: null,
        lastClosingDate: null,
      },
    ];
    bankTransactions = [{ id: 'bt-other', financialAccountId: 'fa-other' }];
    dataSource.query.mockImplementation(async () => []);
  });

  describe('overview', () => {
    it('lists only implemented exports and hides features of unimplemented exports', async () => {
      const overview = await service.overview(tenantScope);

      expect(overview.profile.exports).toEqual(['datev', 'xaf', 'gdpdu']);
      expect(overview.features.map((f) => f.key)).toEqual(['ustva', 'datev', 'xaf', 'gdpdu']);
      // Posting issues are entity-wide; tenant-scoped viewers do not get the count.
      expect(overview).toEqual(
        expect.objectContaining({ globalAccess: false, tenantFilter: 'acme', openPostingIssues: null }),
      );
      expect(postingIssueRepo.count).not.toHaveBeenCalled();
    });
  });

  describe('scope utilities', () => {
    const globalViews = { isGlobalViewsAllowedForTenant: jest.fn((tenant: string) => tenant === 'default') };

    it('assertGlobalAccounting refuses tenants without global views', () => {
      runWithTenantId('acme', () => {
        expect(() => assertGlobalAccounting(globalViews as never)).toThrow(ForbiddenException);
      });
      runWithTenantId('default', () => {
        expect(assertGlobalAccounting(globalViews as never)).toEqual({
          tenantFilter: null,
          requestTenantId: 'default',
          global: true,
        });
      });
    });

    it('resolveAccountingScope defaults to the request tenant and guards cross-tenant views', () => {
      runWithTenantId('acme', () => {
        expect(resolveAccountingScope(globalViews as never)).toEqual({
          tenantFilter: 'acme',
          requestTenantId: 'acme',
          global: false,
        });
        expect(resolveAccountingScope(globalViews as never, 'acme')).toEqual({
          tenantFilter: 'acme',
          requestTenantId: 'acme',
          global: false,
        });
        expect(() => resolveAccountingScope(globalViews as never, ' all ')).toThrow(ForbiddenException);
        expect(() => resolveAccountingScope(globalViews as never, 'other')).toThrow(ForbiddenException);
      });
      runWithTenantId('default', () => {
        expect(resolveAccountingScope(globalViews as never, 'other')).toEqual({
          tenantFilter: 'other',
          requestTenantId: 'default',
          global: true,
        });
        expect(resolveAccountingScope(globalViews as never, 'all')).toEqual({
          tenantFilter: null,
          requestTenantId: 'default',
          global: true,
        });
      });
    });
  });

  describe('journal', () => {
    it('filters the journal by tenant and escapes LIKE wildcards in the search', async () => {
      const result = await service.listJournal(tenantScope, { search: ' 50%_off ', limit: 20, offset: 0 });

      expect(journalQb['andWhere']).toHaveBeenCalledWith('e.tenant_id = :tenantId', { tenantId: 'acme' });
      expect(journalQb['andWhere']).toHaveBeenCalledWith(expect.any(Brackets));
      expect(result.items[0].lines.map((l: { lineNo: number }) => l.lineNo)).toEqual([1, 2]);

      const brackets = journalQb['andWhere'].mock.calls.find((c) => c[0] instanceof Brackets)![0] as Brackets;
      const inner = { where: jest.fn(() => inner), orWhere: jest.fn(() => inner) };

      brackets.whereFactory(inner as never);

      expect(inner.where).toHaveBeenCalledWith('e.description ILIKE :term', { term: '%50\\%\\_off%' });
    });

    it('has no tenant filter in the global view', async () => {
      await service.listJournal(globalAll, { limit: 20, offset: 0 });

      expect(journalQb['andWhere']).not.toHaveBeenCalledWith('e.tenant_id = :tenantId', expect.anything());
    });

    it('hides entries of other tenants from read and write operations', async () => {
      await expect(service.getEntry('e-other', tenantScope)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.reverseEntry('e-other', {}, tenantScope, 'u1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.addLink('e-other', { linkType: 'invoice', targetId: 'inv-1' } as never, tenantScope, 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.removeLink('e-other', 'link-1', tenantScope, 'u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(journal.reverse).not.toHaveBeenCalled();
      expect(journal.addLink).not.toHaveBeenCalled();
      expect(journal.removeLink).not.toHaveBeenCalled();

      await expect(service.getEntry('e-other', globalAll)).resolves.toEqual(
        expect.objectContaining({ id: 'e-other', links: [] }),
      );
    });

    it('books manual entries gross with the VAT split off and the caller tenant as dimension', async () => {
      await service.createManualEntry(
        {
          documentDate: '2026-03-12',
          description: 'Office supplies',
          lines: [
            { accountNumber: '4900', debit: 119, taxCode: 'IN_STD' },
            { accountNumber: '1200', credit: 119 },
          ],
        } as never,
        tenantScope,
        'u1',
      );

      const [entry] = posted;

      expect(entry).toEqual(
        expect.objectContaining({
          kind: JournalEntryKind.MANUAL,
          sourceType: JournalSourceType.MANUAL,
          tenantId: 'acme',
          currency: 'EUR',
        }),
      );
      expect(entry.lines).toEqual([
        expect.objectContaining({ accountId: 'acc-4900', debit: 100, taxRole: 'base', tenantId: 'acme' }),
        expect.objectContaining({ accountId: 'acc-vat-in', debit: 19, taxRole: 'tax', tenantId: 'acme' }),
        expect.objectContaining({ accountId: 'acc-1200', credit: 119 }),
      ]);
      expect(journal.post).toHaveBeenCalledWith(expect.anything(), manager);
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ process: 'accounting.entry.manual' }));
    });

    it('requires global access to book for another tenant or without tenant', async () => {
      const dto = {
        documentDate: '2026-03-12',
        description: 'x',
        tenantId: 'other',
        lines: [
          { accountNumber: '1200', debit: 1 },
          { accountNumber: '1800', credit: 1 },
        ],
      };

      await expect(service.createManualEntry(dto as never, tenantScope, 'u1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();

      await service.createManualEntry({ ...dto, tenantId: 'none' } as never, globalAll, 'u1');
      await service.createManualEntry({ ...dto, tenantId: undefined } as never, globalViewingOther, 'u1');

      expect(posted.map((p) => p.tenantId)).toEqual([null, 'other']);
    });

    it('rejects lines with both or neither side and unknown accounts', async () => {
      const base = { documentDate: '2026-03-12', description: 'x' };

      await expect(
        service.createManualEntry(
          { ...base, lines: [{ accountNumber: '1200', debit: 1, credit: 1 }] } as never,
          tenantScope,
          'u1',
        ),
      ).rejects.toThrow(/either a debit or a credit/);
      await expect(
        service.createManualEntry({ ...base, lines: [{ accountNumber: '1200' }] } as never, tenantScope, 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createManualEntry(
          { ...base, lines: [{ accountNumber: '9999', debit: 1 }] } as never,
          tenantScope,
          'u1',
        ),
      ).rejects.toThrow(/Account 9999 does not exist/);
      expect(journal.post).not.toHaveBeenCalled();
    });
  });

  describe('receipts', () => {
    const pdf = {
      buffer: Buffer.from('%PDF-1.7 receipt'),
      originalname: '../Beleg März.pdf',
      mimetype: 'application/pdf',
      size: 16,
    };

    it('stores receipts under the entry tenant with a sanitized name and links them', async () => {
      await service.attachReceipt('e-acme', pdf, tenantScope, 'u1');

      const storageKey = fileStorage.writeAccountingReceiptFile.mock.calls[0][0] as string;

      expect(storageKey).toMatch(/^acme\/2026-03\/e-acme-[0-9a-f]{12}-\.\._Beleg M_rz\.pdf$/);
      expect(storedFileRegistry.registerFromBuffer).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'acme', scope: FileStorageScope.accountingReceipts, storageKey }),
      );
      expect(journal.addLink).toHaveBeenCalledWith(
        'e-acme',
        expect.objectContaining({ linkType: 'stored_file', targetId: 'sf-1', role: JournalLinkRole.RECEIPT }),
        'u1',
      );
    });

    it('rejects foreign entries, disallowed types and fake PDFs before storing', async () => {
      await expect(service.attachReceipt('e-other', pdf, tenantScope, 'u1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.attachReceipt('e-acme', { ...pdf, mimetype: 'text/html' }, tenantScope, 'u1'),
      ).rejects.toThrow(/must be PDF/);
      await expect(
        service.attachReceipt('e-acme', { ...pdf, buffer: Buffer.from('<html>') }, tenantScope, 'u1'),
      ).rejects.toThrow(/not a PDF/);
      await expect(
        service.attachReceipt('e-acme', { ...pdf, buffer: Buffer.alloc(0) }, tenantScope, 'u1'),
      ).rejects.toThrow(/Empty file/);
      expect(fileStorage.writeAccountingReceiptFile).not.toHaveBeenCalled();
    });

    it('serves receipts only to their tenant or global operators', async () => {
      dataSource.query.mockResolvedValue([
        {
          storage_key: 'other/2026-03/123e4567-e89b-12d3-a456-426614174000-abcdef012345-Beleg.pdf',
          tenant_id: 'other',
        },
      ]);

      await expect(service.downloadReceipt('sf-9', tenantScope)).rejects.toBeInstanceOf(NotFoundException);
      expect(fileStorage.readAccountingReceiptFile).not.toHaveBeenCalled();
      expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('scope = $2'), [
        'sf-9',
        FileStorageScope.accountingReceipts,
      ]);

      await expect(service.downloadReceipt('sf-9', globalAll)).resolves.toEqual(
        expect.objectContaining({ fileName: 'Beleg.pdf' }),
      );
    });
  });

  describe('banking master data', () => {
    it('scopes financial accounts: own tenant, plus shared accounts for global operators, all for the global view', async () => {
      await service.listFinancialAccounts(tenantScope);
      await service.listFinancialAccounts(globalViewingOther);
      await service.listFinancialAccounts(globalAll);

      expect(financialAccountRepo.find.mock.calls).toEqual([
        [{ where: { tenantId: 'acme' }, order: { name: 'ASC' } }],
        [{ where: [{ tenantId: 'other' }, { tenantId: IsNull() }], order: { name: 'ASC' } }],
        [{ order: { name: 'ASC' } }],
      ]);
    });

    it('protects financial accounts of other tenants and shared accounts', async () => {
      const dto = {
        name: 'Giro',
        kind: 'bank',
        iban: 'DE89 3704 0044 0532 0130 00',
        currency: 'EUR',
        ledgerAccountNumber: '1200',
      };

      await expect(service.saveFinancialAccount('fa-other', dto as never, tenantScope, 'u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.saveFinancialAccount(null, { ...dto, tenantId: null } as never, tenantScope, 'u1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.saveFinancialAccount(null, { ...dto, iban: 'DE00370400440532013000' } as never, tenantScope, 'u1'),
      ).rejects.toThrow(/Invalid IBAN/);
      expect(financialAccountRepo.save).not.toHaveBeenCalled();

      const saved = await service.saveFinancialAccount(
        null,
        { ...dto, processor: 'stripe' } as never,
        tenantScope,
        'u1',
      );

      expect(saved).toEqual(
        expect.objectContaining({ tenantId: 'acme', iban: 'DE89370400440532013000', processor: null, isActive: true }),
      );
    });

    it('hides bank transactions of foreign accounts and strips raw source lines from lists', async () => {
      await expect(service.suggestionsFor('bt-other', tenantScope)).rejects.toBeInstanceOf(NotFoundException);
      expect(reconciliation.suggest).not.toHaveBeenCalled();

      const list = await service.listTransactions(tenantScope, { limit: 10, offset: 0 });

      expect(txQb['where']).toHaveBeenCalledWith({ financialAccountId: In(['fa-1']) });
      expect(list.items[0]).toEqual(expect.objectContaining({ id: 'bt-1', raw: undefined }));
    });

    it('returns no transactions when a requested account is not visible', async () => {
      financialAccounts = [financialAccounts[0]];

      await expect(
        service.listTransactions(tenantScope, { financialAccountId: 'fa-other', limit: 10, offset: 0 }),
      ).resolves.toEqual({ items: [], total: 0 });
      expect(txQb['getManyAndCount']).not.toHaveBeenCalled();
    });
  });

  describe('statistics', () => {
    it('applies the tenant filter to journal statistics and computes KPIs in cents', async () => {
      const stats = await service.journalStatistics(tenantScope, '2026-01-01', '2026-12-31');

      expect(reports.journalSeries).toHaveBeenCalledWith('2026-01-01', '2026-12-31', 'acme', 'month');
      expect(reports.resultSeries).toHaveBeenCalledWith('2026-01-01', '2026-12-31', 'acme');
      expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('AND e.tenant_id = $3'), [
        '2026-01-01',
        '2026-12-31',
        'acme',
      ]);
      expect(stats.kpis).toEqual({
        entries: 4,
        manualShare: 0.25,
        volume: 100.3,
        revenue: 1000,
        expenses: 400.5,
        result: 599.5,
      });
    });

    it('omits the tenant filter in the global view', async () => {
      await service.journalStatistics(globalAll, '2026-01-01', '2026-12-31');

      const [sql, params] = dataSource.query.mock.calls[0];

      expect(sql).not.toContain('tenant_id');
      expect(params).toEqual(['2026-01-01', '2026-12-31']);
      expect(reports.journalSeries).toHaveBeenCalledWith('2026-01-01', '2026-12-31', null, 'month');
    });

    it('computes bank statistics over the visible accounts only', async () => {
      financialAccounts = [financialAccounts[0]];
      reconciliation.statusCounts.mockResolvedValueOnce([
        { status: 'matched', count: 3 },
        { status: 'unmatched', count: 1 },
      ]);

      const stats = await service.bankStatistics(tenantScope, '2026-01-01', '2026-12-31');

      expect(financialAccountRepo.find).toHaveBeenCalledWith({ where: { tenantId: 'acme' }, order: { name: 'ASC' } });
      expect(reconciliation.statusCounts).toHaveBeenCalledWith(['fa-1']);
      expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('financial_account_id = ANY($1)'), [
        ['fa-1'],
        '2026-01-01',
        '2026-12-31',
      ]);
      expect(stats.kpis).toEqual({
        accounts: 1,
        transactions: 4,
        reconciliationRate: 0.75,
        unmatched: 1,
        balance: 100.5,
      });
    });

    it('does not query flows without visible accounts', async () => {
      financialAccounts = [];

      const stats = await service.bankStatistics(tenantScope, '2026-01-01', '2026-12-31');

      expect(dataSource.query).not.toHaveBeenCalled();
      expect(stats.kpis).toEqual(expect.objectContaining({ accounts: 0, transactions: 0, reconciliationRate: 1 }));
    });
  });
});
