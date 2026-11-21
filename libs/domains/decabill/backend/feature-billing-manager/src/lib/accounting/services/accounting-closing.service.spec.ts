import { BadRequestException } from '@nestjs/common';

import {
  AccountingAccountRole as R,
  AccountingAccountType as T,
  CounterpartyType,
  FiscalYearStatus,
  JournalEntryKind,
  JournalSourceType,
} from '../constants/accounting.constants';

import { AccountingClosingService } from './accounting-closing.service';
import type { PostEntryInput } from './accounting-journal.service';

interface Account {
  id: string;
  chartId: string;
  number: string;
  name: string;
  type: T;
  role: R | null;
}

const account = (chartId: string, id: string, number: string, type: T, role: R | null = null): Account => ({
  id,
  chartId,
  number,
  name: `Account ${number}`,
  type,
  role,
});
const SKR03 = [
  account('c1', 'a-bank', '1200', T.ASSET, R.BANK),
  account('c1', 'a-ar', '1400', T.ASSET, R.RECEIVABLES),
  account('c1', 'a-ap', '1600', T.LIABILITY, R.PAYABLES),
  account('c1', 'a-loan', '0630', T.LIABILITY),
];
const SKR04 = [
  account('c2', 'b-bank', '1800', T.ASSET, R.BANK),
  account('c2', 'b-ar', '1200', T.ASSET, R.RECEIVABLES),
  account('c2', 'b-ap', '3300', T.LIABILITY, R.PAYABLES),
  account('c2', 'b-loan', '3150', T.LIABILITY),
];

describe('AccountingClosingService', () => {
  const year2026 = {
    id: 'fy-2026',
    name: '2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    chartId: 'c1',
    status: FiscalYearStatus.OPEN,
  };
  const year2027 = {
    id: 'fy-2027',
    name: '2027',
    startDate: '2027-01-01',
    endDate: '2027-12-31',
    chartId: 'c1',
    status: FiscalYearStatus.OPEN,
  };
  let balances: Array<{ id: string; tenant_id?: string | null; balance: string }>;
  let openItems: Array<Record<string, string | null>>;
  let result: string;
  const manager = {
    name: 'tx-manager',
    query: jest.fn(async (sql: string, params?: unknown[]): Promise<unknown[]> => {
      if (sql.includes('FROM billing_accounting_periods') && sql.includes('FOR UPDATE')) {
        return [];
      }

      if (sql.includes('FROM billing_accounting_fiscal_years') && sql.includes('FOR UPDATE')) {
        return [{ status: FiscalYearStatus.OPEN }];
      }

      return await dataSource.query(sql, params);
    }),
    getRepository: () => dataSource.getRepository(),
  };
  const dataSource = {
    query: jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('AS result')) {
        return [{ result }];
      }

      if (sql.includes('l.open_item_id IS NOT NULL')) {
        return openItems;
      }

      if (sql.includes("a.type IN ('asset', 'liability', 'equity')")) {
        return balances;
      }

      return [];
    }),
    getRepository: jest.fn(() => ({
      find: jest.fn(async ({ where }: { where: { chartId: string } }) =>
        [...SKR03, ...SKR04].filter((a) => a.chartId === where.chartId),
      ),
    })),
    transaction: jest.fn(async (cb: (m: typeof manager) => Promise<unknown>) => await cb(manager)),
    get manager() {
      return manager;
    },
  };
  const fiscalYears = {
    getYear: jest.fn(),
    findYearForDate: jest.fn(),
    openNextYear: jest.fn(),
    changeChartOfEmptyYear: jest.fn(),
    markClosed: jest.fn(async () => undefined),
  };
  const charts = {
    requireAccountByRole: jest.fn(async (chartId: string, role: R) => ({ id: `${chartId}:${role}` })),
    getAccountByRole: jest.fn(
      async (chartId: string, role: R) =>
        [...SKR03, ...SKR04].find((a) => a.chartId === chartId && a.role === role) ?? null,
    ),
    listAccounts: jest.fn(async (chartId: string) => [...SKR03, ...SKR04].filter((a) => a.chartId === chartId)),
  };
  const journal = {
    post: jest.fn(async (_input: PostEntryInput, _manager?: unknown) => ({ entry: { id: 'eb-1' }, created: true })),
  };
  const service = new AccountingClosingService(
    dataSource as never,
    fiscalYears as never,
    charts as never,
    journal as never,
  );
  const posted = (): PostEntryInput => journal.post.mock.calls[0][0];
  const lines = (accountId: string) => posted().lines.filter((l) => l.accountId === accountId);

  beforeEach(() => {
    jest.clearAllMocks();
    balances = [
      { id: 'a-bank', balance: '1000.00' },
      // Balances come per account and tenant (posting dimension).
      { id: 'a-ar', tenant_id: 'acme', balance: '200.00' },
      { id: 'a-ar', tenant_id: null, balance: '150.00' },
      { id: 'a-ap', tenant_id: 'acme', balance: '-150.00' },
    ];
    openItems = [
      {
        account_id: 'a-ar',
        open_item_id: 'inv-1',
        counterparty_type: 'customer',
        counterparty_id: 'u-1',
        tenant_id: 'acme',
        balance: '200',
      },
      {
        account_id: 'a-ar',
        open_item_id: 'inv-2',
        counterparty_type: 'customer',
        counterparty_id: 'u-2',
        tenant_id: null,
        balance: '100',
      },
      {
        account_id: 'a-ap',
        open_item_id: 'si-1',
        counterparty_type: 'supplier',
        counterparty_id: 'sup-1',
        tenant_id: 'acme',
        balance: '-150',
      },
    ];
    result = '1200.00';
    fiscalYears.getYear.mockResolvedValue({ ...year2026 });
    fiscalYears.findYearForDate.mockImplementation(async (date: string) =>
      date === '2027-01-01' ? { ...year2027 } : null,
    );
  });

  it('refuses to close a year that is already closed (no second carry-forward)', async () => {
    fiscalYears.getYear.mockResolvedValue({ ...year2026, status: FiscalYearStatus.CLOSED });

    await expect(service.close('fy-2026', {}, 'admin')).rejects.toThrow('Fiscal year is already closed');
    await expect(service.close('fy-2026', {}, 'admin')).rejects.toBeInstanceOf(BadRequestException);

    expect(journal.post).not.toHaveBeenCalled();
    expect(fiscalYears.markClosed).not.toHaveBeenCalled();
  });

  it('refuses to close a year while the previous one is still open', async () => {
    fiscalYears.findYearForDate.mockImplementation(async (date: string) =>
      date === '2025-12-31' ? { id: 'fy-2025', name: '2025', status: FiscalYearStatus.OPEN } : null,
    );

    await expect(service.close('fy-2026', {}, 'admin')).rejects.toThrow('Close fiscal year 2025 first');

    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('carries balances forward, open items per item, and the result to retained earnings in one balanced opening entry', async () => {
    await service.close('fy-2026', {}, 'admin');

    const entry = posted();

    expect(entry).toEqual(
      expect.objectContaining({
        documentDate: '2027-01-01',
        documentNumber: 'EB 2027',
        kind: JournalEntryKind.OPENING,
        sourceType: JournalSourceType.FISCAL_YEAR,
        idempotencyKey: 'fiscal_year:fy-2026:carry_forward',
        fiscalYearId: 'fy-2027',
        createdByUserId: 'admin',
      }),
    );
    expect(journal.post.mock.calls[0][1]).toBe(manager);

    const debit = entry.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credit = entry.lines.reduce((s, l) => s + (l.credit ?? 0), 0);

    expect(debit).toBeCloseTo(credit, 2);

    // Plain balance-sheet account: one total against the opening balance account.
    expect(lines('a-bank')).toEqual([expect.objectContaining({ debit: 1000 })]);

    // Receivables: one line per open item (OP-Vortrag) plus the unitemized remainder.
    expect(lines('a-ar')).toEqual([
      expect.objectContaining({
        debit: 200,
        openItemId: 'inv-1',
        counterpartyType: CounterpartyType.CUSTOMER,
        counterpartyId: 'u-1',
        tenantId: 'acme',
      }),
      expect.objectContaining({ debit: 100, openItemId: 'inv-2', counterpartyId: 'u-2' }),
      expect.objectContaining({ debit: 50 }),
    ]);
    expect(lines('a-ar')[2].openItemId).toBeUndefined();
    expect(lines(`c1:${R.OPENING_BALANCE_RECEIVABLES}`)).toEqual([
      expect.objectContaining({ credit: 200 }),
      expect.objectContaining({ credit: 100 }),
    ]);

    // Payables: credit open item against the AP carry-forward account, nothing left over.
    expect(lines('a-ap')).toEqual([
      expect.objectContaining({ credit: 150, openItemId: 'si-1', counterpartyType: CounterpartyType.SUPPLIER }),
    ]);
    expect(lines(`c1:${R.OPENING_BALANCE_PAYABLES}`)).toEqual([expect.objectContaining({ debit: 150 })]);

    // Profit (credit − debit on P&L) increases equity.
    expect(lines(`c1:${R.RETAINED_EARNINGS}`)).toEqual([expect.objectContaining({ credit: 1200 })]);
    expect(fiscalYears.markClosed).toHaveBeenCalledWith(manager, 'fy-2026', 'admin');
  });

  it('books a loss as a debit to retained earnings', async () => {
    balances = [{ id: 'a-bank', balance: '-80' }];
    openItems = [];
    result = '-80';

    await service.close('fy-2026', {}, null);

    expect(lines(`c1:${R.RETAINED_EARNINGS}`)).toEqual([expect.objectContaining({ debit: 80 })]);
    expect(lines('a-bank')).toEqual([expect.objectContaining({ credit: 80 })]);
  });

  it('opens the next year when it does not exist yet', async () => {
    fiscalYears.findYearForDate.mockResolvedValue(null);
    fiscalYears.openNextYear.mockResolvedValue({ ...year2027, id: 'fy-new' });

    await service.close('fy-2026', {}, 'admin');

    expect(fiscalYears.openNextYear).toHaveBeenCalledWith({ chartId: undefined });
    expect(posted().fiscalYearId).toBe('fy-new');
  });

  it('switches the chart only at the year change and maps balances by explicit mapping, then by role', async () => {
    fiscalYears.changeChartOfEmptyYear.mockResolvedValue({ ...year2027, chartId: 'c2' });
    balances = [...balances, { id: 'a-loan', balance: '-500' }];

    await service.close('fy-2026', { nextChartId: 'c2', accountMapping: { '0630': '3150' } }, 'admin');

    expect(fiscalYears.changeChartOfEmptyYear).toHaveBeenCalledWith('fy-2027', 'c2');
    expect(lines('b-bank')).toEqual([expect.objectContaining({ debit: 1000 })]);
    expect(lines('b-ar').map((l) => l.openItemId)).toEqual(['inv-1', 'inv-2', undefined]);
    expect(lines('b-ap')).toEqual([expect.objectContaining({ credit: 150, openItemId: 'si-1' })]);
    expect(lines('b-loan')).toEqual([expect.objectContaining({ credit: 500 })]);
    expect(lines(`c2:${R.OPENING_BALANCE}`).length).toBeGreaterThan(0);
    expect(posted().lines.some((l) => l.accountId.startsWith('a-'))).toBe(false);
  });

  it('refuses the chart change when a balance has no account in the new chart (nothing booked, year stays open)', async () => {
    fiscalYears.changeChartOfEmptyYear.mockResolvedValue({ ...year2027, chartId: 'c2' });
    balances = [...balances, { id: 'a-loan', balance: '-500' }];

    await expect(service.close('fy-2026', { nextChartId: 'c2' }, 'admin')).rejects.toThrow(
      /No account in the next year's chart for: 0630/,
    );

    expect(journal.post).not.toHaveBeenCalled();
    expect(fiscalYears.markClosed).not.toHaveBeenCalled();
  });

  it('still closes the year when there is nothing to carry forward', async () => {
    balances = [];
    openItems = [];
    result = '0';

    await service.close('fy-2026', {}, 'admin');

    expect(journal.post).not.toHaveBeenCalled();
    expect(fiscalYears.markClosed).toHaveBeenCalledWith(manager, 'fy-2026', 'admin');
  });

  it('previews the target chart, result and unmapped accounts without booking', async () => {
    balances = [...balances, { id: 'a-loan', balance: '-500' }];

    const preview = await service.preview('fy-2026', { nextChartId: 'c2' });

    expect(preview.targetChartId).toBe('c2');
    expect(preview.chartChanges).toBe(true);
    expect(preview.result).toBe(1200);
    expect(preview.unmapped).toEqual(['0630']);
    expect(preview.balances).toEqual(
      expect.arrayContaining([
        { number: '1200', name: 'Account 1200', balance: 1000, targetNumber: '1800' },
        { number: '0630', name: 'Account 0630', balance: -500, targetNumber: null },
      ]),
    );
    expect(journal.post).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
