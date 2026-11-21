import { BadRequestException } from '@nestjs/common';

import { AccountingAccountType as T, CounterpartyType } from '../constants/accounting.constants';
import type { StatementLayout } from '../profiles/accounting-profile.types';

import { AccountingReportsService } from './accounting-reports.service';

describe('AccountingReportsService', () => {
  const accounts = [
    { id: 'bank', number: '1200', name: 'Bank', type: T.ASSET, statementPosition: 'A.1', chartId: 'chart-26' },
    { id: 'ar', number: '1400', name: 'Receivables', type: T.ASSET, statementPosition: 'A.2', chartId: 'chart-26' },
    { id: 'suspense', number: '1590', name: 'Suspense', type: T.ASSET, statementPosition: null, chartId: 'chart-26' },
    { id: 'equity', number: '0800', name: 'Capital', type: T.EQUITY, statementPosition: 'P.1', chartId: 'chart-26' },
    { id: 'ap', number: '1600', name: 'Payables', type: T.LIABILITY, statementPosition: 'P.2', chartId: 'chart-26' },
    {
      id: 'rev',
      number: '8400',
      name: 'Revenue 19%',
      type: T.REVENUE,
      statementPosition: 'pl.rev',
      chartId: 'chart-26',
    },
    {
      id: 'exp',
      number: '4900',
      name: 'Other expenses',
      type: T.EXPENSE,
      statementPosition: 'pl.exp',
      chartId: 'chart-26',
    },
  ];
  const balanceSheet: StatementLayout = {
    key: 'hgb-bs',
    name: 'Bilanz',
    kind: 'balance_sheet',
    assets: [
      {
        code: 'A',
        label: 'Assets',
        children: [
          { code: 'A.1', label: 'Bank' },
          { code: 'A.2', label: 'Receivables' },
        ],
      },
    ],
    equityAndLiabilities: [
      { code: 'P.1', label: 'Equity' },
      { code: 'P.2', label: 'Liabilities' },
    ],
    resultPosition: 'P.1',
  };
  const profitAndLoss: StatementLayout = {
    key: 'hgb-pl',
    name: 'GuV',
    kind: 'profit_and_loss',
    lines: [
      {
        code: 'OP',
        label: 'Operating result',
        children: [
          { code: 'pl.rev', label: 'Revenue', sign: 1 },
          { code: 'pl.exp', label: 'Expenses', sign: -1 },
        ],
      },
    ],
  };
  const years: Record<string, { chartId: string; startDate: string; endDate: string } | null> = {
    '2026': { chartId: 'chart-26', startDate: '2026-01-01', endDate: '2026-12-31' },
    '2025': null,
  };
  /** debit − credit per account, keyed by the `from` date of the balance query. */
  let balancesByFrom: Record<string, Array<{ id: string; amount: string }>>;
  let trialRows: unknown[];
  let openItemRows: unknown[];
  let ledgerRows: { opening: unknown[]; count: unknown[]; items: Array<Record<string, unknown>> };
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });

      if (sql.includes('AS opening')) return trialRows;

      if (sql.includes('SUM(l.debit - l.credit) AS amount') && sql.includes('a.chart_id = $1'))
        return balancesByFrom[params[1] as string] ?? [];

      if (sql.includes('GROUP BY l.open_item_id')) return openItemRows;

      if (sql.includes('AS balance')) return ledgerRows.opening;

      if (sql.includes('COUNT(*)::text')) return ledgerRows.count;

      if (sql.includes('OVER (ORDER BY')) return ledgerRows.items;

      return [];
    }),
    getRepository: () => ({
      find: jest.fn(async (options?: { where?: { chartId?: string } }) => {
        const chartId = options?.where?.chartId;

        return accounts.filter((a) => !chartId || a.chartId === chartId);
      }),
      findOneOrFail: jest.fn(async ({ where }: { where: { id: string } }) => accounts.find((a) => a.id === where.id)),
    }),
  };
  let profile: Record<string, unknown>;
  const config = { getConfig: jest.fn(() => ({ profile })) };
  const fiscalYears = { findYearForDate: jest.fn(async (date: string) => years[date.slice(0, 4)] ?? null) };
  const service = new AccountingReportsService(dataSource as never, config as never, fiscalYears as never);
  const lastQuery = (fragment: string) => [...queries].reverse().find((q) => q.sql.includes(fragment))!;

  beforeEach(() => {
    jest.clearAllMocks();
    queries.length = 0;
    years['2025'] = null;
    profile = { country: 'DE', balanceSheet, profitAndLoss, cashBasis: undefined };
    balancesByFrom = {
      '2026-01-01': [
        { id: 'bank', amount: '1000.00' },
        { id: 'ar', amount: '190.00' },
        { id: 'suspense', amount: '25.00' },
        { id: 'equity', amount: '-500.00' },
        { id: 'ap', amount: '-325.00' },
        { id: 'rev', amount: '-800.00' },
        { id: 'exp', amount: '410.00' },
        { id: 'foreign-chart-account', amount: '999.00' },
      ],
    };
    trialRows = [];
    openItemRows = [];
    ledgerRows = { opening: [], count: [], items: [] };
  });

  describe('trialBalance', () => {
    it('sums opening + debit − credit per account in exact cents', async () => {
      trialRows = [
        {
          id: 'bank',
          number: '1200',
          name: 'Bank',
          type: T.ASSET,
          statement_position: 'A.1',
          opening: '0.10',
          debit: '0.20',
          credit: '0.00',
        },
        {
          id: 'rev',
          number: '8400',
          name: 'Revenue',
          type: T.REVENUE,
          statement_position: 'pl.rev',
          opening: '-100.00',
          debit: '10.00',
          credit: '250.55',
        },
      ];

      const rows = await service.trialBalance('2026-03-01', '2026-03-31', null);

      expect(rows).toEqual([
        expect.objectContaining({ accountId: 'bank', opening: 0.1, debit: 0.2, credit: 0, closing: 0.3 }),
        expect.objectContaining({ accountId: 'rev', statementPosition: 'pl.rev', closing: -340.55 }),
      ]);
    });

    it('filters by the tenant dimension only when a tenant is given', async () => {
      await service.trialBalance('2026-03-01', '2026-03-31', 'acme');

      const scoped = lastQuery('AS opening');

      expect(scoped.sql).toContain('AND l.tenant_id = $5');
      expect(scoped.params).toEqual(['chart-26', '2026-01-01', '2026-03-01', '2026-03-31', 'acme']);

      await service.trialBalance('2026-03-01', '2026-03-31', null);

      const global = lastQuery('AS opening');

      expect(global.sql).not.toContain('tenant_id');
      expect(global.params).toEqual(['chart-26', '2026-01-01', '2026-03-01', '2026-03-31']);
    });

    it('returns nothing without a fiscal year and rejects invalid ranges', async () => {
      await expect(service.trialBalance('2024-01-01', '2024-01-31', null)).resolves.toEqual([]);
      await expect(service.trialBalance('2026-03-31', '2026-03-01', null)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.trialBalance("2026-03-01'; --", '2026-03-31', null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('balanceSheet', () => {
    it('places accounts by layout code: assets debit-positive, equity/liabilities credit-positive, result in equity', async () => {
      const report = await service.balanceSheet('2026-03-31', null);
      const [assets, equity] = report.sections;

      expect(report).toEqual(
        expect.objectContaining({ layoutKey: 'hgb-bs', from: '2026-01-01', to: '2026-03-31', result: 390 }),
      );
      expect(assets.nodes[0]).toEqual(expect.objectContaining({ code: 'A', amount: 1190 }));
      expect(assets.nodes[0].children.map((c) => [c.code, c.amount])).toEqual([
        ['A.1', 1000],
        ['A.2', 190],
      ]);
      expect(assets.total).toBe(1190);
      expect(equity.nodes.map((n) => [n.code, n.amount])).toEqual([
        ['P.1', 890],
        ['P.2', 325],
      ]);
      expect(equity.nodes[0].accounts).toEqual([
        { number: '0800', name: 'Capital', amount: 500 },
        { number: '—', name: 'Result of the period', amount: 390 },
      ]);
      expect(equity.total).toBe(1215);
      // Asset without a statement position is surfaced instead of disappearing (explains 1215 vs. 1190).
      expect(report.unassigned).toEqual([{ number: '1590', name: 'Suspense', amount: 25 }]);
    });

    it('ignores balances of accounts outside the fiscal year chart', async () => {
      const report = await service.balanceSheet('2026-03-31', null);

      expect(JSON.stringify(report)).not.toContain('999');
    });

    it('adds previous-year amounts per position with the side sign', async () => {
      years['2025'] = { chartId: 'chart-26', startDate: '2025-01-01', endDate: '2025-12-31' };
      balancesByFrom['2025-01-01'] = [
        { id: 'bank', amount: '700.00' },
        { id: 'equity', amount: '-400.00' },
        { id: 'ap', amount: '-300.00' },
      ];

      const report = await service.balanceSheet('2026-03-31', 'acme');

      expect(fiscalYears.findYearForDate).toHaveBeenCalledWith('2025-12-31');
      expect(report.sections[0].nodes[0]).toEqual(expect.objectContaining({ code: 'A', previousAmount: 700 }));
      expect(report.sections[1].nodes.map((n) => n.previousAmount)).toEqual([400, 300]);
      expect(queries.filter((q) => q.sql.includes('a.chart_id = $1')).every((q) => q.params[3] === 'acme')).toBe(true);
    });

    it('requires a fiscal year', async () => {
      await expect(service.balanceSheet('2024-06-30', null)).rejects.toThrow(/No fiscal year covers 2024-06-30/);
    });
  });

  describe('profitAndLoss', () => {
    it('shows revenue positive and expenses negative so the parent line is the result', async () => {
      const report = await service.profitAndLoss('2026-01-01', '2026-03-31', 'acme');
      const [op] = report.sections[0].nodes;

      expect(op.children.map((c) => [c.code, c.amount])).toEqual([
        ['pl.rev', 800],
        ['pl.exp', -410],
      ]);
      expect(op.amount).toBe(390);
      expect(report.result).toBe(390);
      expect(report.sections[0].total).toBe(390);
      // Balance-sheet accounts never land in the P&L "unassigned" list.
      expect(report.unassigned).toEqual([]);
      expect(lastQuery('a.chart_id = $1').sql).toContain('AND l.tenant_id = $4');
    });

    it('rejects a missing fiscal year and an inverted range; cash basis needs a profile layout', async () => {
      await expect(service.profitAndLoss('2024-01-01', '2024-03-31', null)).rejects.toThrow(/No fiscal year covers/);
      await expect(service.profitAndLoss('2026-03-31', '2026-01-01', null)).rejects.toThrow(/Invalid date range/);
      await expect(service.cashBasis('2026-01-01', '2026-03-31', null)).rejects.toThrow(
        /DE profile has no cash-basis statement/,
      );
    });
  });

  describe('openItems', () => {
    it('lists open customer items with overdue days and aging buckets', async () => {
      openItemRows = [
        {
          open_item_id: 'inv-1',
          counterparty_id: 'u1',
          number: 'INV-1',
          doc_date: '2026-02-01',
          due_date: '2026-03-01',
          amount: '119.00',
          open: '119.00',
          tenant_id: 'acme',
        },
        {
          open_item_id: 'inv-2',
          counterparty_id: 'u2',
          number: 'INV-2',
          doc_date: '2026-04-10',
          due_date: '2026-04-24',
          amount: '50.00',
          open: '20.00',
          tenant_id: 'acme',
        },
        {
          open_item_id: 'inv-3',
          counterparty_id: 'u1',
          number: 'INV-3',
          doc_date: '2025-10-01',
          due_date: '2025-11-01',
          amount: '10.00',
          open: '10.00',
          tenant_id: 'acme',
        },
      ];

      const result = await service.openItems(CounterpartyType.CUSTOMER, '2026-04-15', 'acme');

      expect(result.items.map((i) => [i.openItemId, i.counterpartyId, i.open, i.daysOverdue])).toEqual([
        ['inv-1', 'u1', 119, 45],
        ['inv-2', 'u2', 20, 0],
        ['inv-3', 'u1', 10, 165],
      ]);
      expect(result.aging).toEqual({ current: 20, '1-30': 0, '31-60': 119, '61-90': 0, '90+': 10 });
      expect(result.total).toBe(149);

      const query = lastQuery('GROUP BY l.open_item_id');

      expect(query.sql).toContain('LEFT JOIN billing_invoices d');
      expect(query.sql).toContain('AND l.tenant_id = $3');
      expect(query.params).toEqual([CounterpartyType.CUSTOMER, '2026-04-15', 'acme']);
    });

    it('flips the sign for supplier items and joins supplier invoices; global view has no tenant filter', async () => {
      openItemRows = [
        {
          open_item_id: 'si-1',
          counterparty_id: 's1',
          number: null,
          doc_date: null,
          due_date: null,
          amount: '200.00',
          open: '-200.00',
          tenant_id: null,
        },
      ];

      const result = await service.openItems(CounterpartyType.SUPPLIER, '2026-04-15', null);

      expect(result.items[0]).toEqual(
        expect.objectContaining({ openItemId: 'si-1', open: 200, daysOverdue: 0, dueDate: null }),
      );

      const query = lastQuery('GROUP BY l.open_item_id');

      expect(query.sql).toContain('LEFT JOIN billing_supplier_invoices d');
      expect(query.sql).not.toContain('l.tenant_id = $');
      expect(query.params).toEqual([CounterpartyType.SUPPLIER, '2026-04-15']);
    });
  });

  describe('accountLedger', () => {
    it('adds the year-to-date opening balance to running and closing balances (tenant-filtered)', async () => {
      ledgerRows = {
        opening: [{ balance: '100.10' }],
        count: [{ count: '2', closing: '-30.00' }],
        items: [
          { entryId: 'e1', running: 20 },
          { entryId: 'e2', running: -30 },
        ],
      };

      const result = await service.accountLedger('bank', '2026-03-01', '2026-03-31', 'acme', 50, 0);

      expect(result).toEqual(expect.objectContaining({ opening: 100.1, total: 2, closing: 70.1 }));
      expect(result.items.map((i) => i['running'])).toEqual([120.1, 70.1]);

      const opening = lastQuery('AS balance');

      expect(opening.sql).toContain('l.tenant_id = $2');
      expect(opening.params).toEqual(['bank', 'acme', '2026-01-01', '2026-03-01']);
      expect(lastQuery('OVER (ORDER BY').params).toEqual(['bank', 'acme', '2026-03-01', '2026-03-31', 50, 0]);
    });
  });
});
