import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { AccountingPeriodStatus, FiscalYearStatus } from '../constants/accounting.constants';
import { AccountingFiscalYearEntity } from '../entities/accounting-fiscal-year.entity';
import { AccountingPeriodEntity } from '../entities/accounting-period.entity';

import { AccountingFiscalYearService } from './accounting-fiscal-year.service';

interface Year {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  chartId: string;
  status: FiscalYearStatus;
  closedAt?: Date | null;
  closedByUserId?: string | null;
}

interface Period {
  id: string;
  fiscalYearId: string;
  periodIndex: number;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatus;
  lockedAt?: Date | null;
  lockedByUserId?: string | null;
}

/** Unwraps typeorm FindOperators (LessThanOrEqual / MoreThanOrEqual) for the in-memory repositories. */
function operand(value: unknown): { type: string | null; value: unknown } {
  if (value && typeof value === 'object' && 'type' in value && 'value' in value) {
    return { type: String((value as { type: string }).type), value: (value as { value: unknown }).value };
  }

  return { type: null, value };
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, raw]) => {
    const { type, value } = operand(raw);
    const actual = row[key] as string;

    if (type === 'lessThanOrEqual') {
      return actual <= (value as string);
    }

    if (type === 'moreThanOrEqual') {
      return actual >= (value as string);
    }

    return actual === value;
  });
}

describe('AccountingFiscalYearService', () => {
  let years: Year[];
  let periods: Period[];
  const settings = { startDate: '2026-01-01', fiscalYearStartMonth: 1, defaultChartTemplate: 'DE-SKR03' };
  /** Query builder over the period store: collects the named parameters and evaluates the service's queries. */
  const periodQueryBuilder = () => {
    const params: Record<string, unknown> = {};
    const qb: Record<string, jest.Mock> = {
      where: jest.fn((_sql: string, p: Record<string, unknown> = {}) => (Object.assign(params, p), qb)),
      andWhere: jest.fn((_sql: string, p: Record<string, unknown> = {}) => (Object.assign(params, p), qb)),
      innerJoin: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      setLock: jest.fn(() => qb),
      getOne: jest.fn(async () => {
        if (params['id']) {
          return periods.find((p) => p.id === params['id']) ?? null;
        }

        return (
          periods
            .filter(
              (p) =>
                p.fiscalYearId === params['yearId'] &&
                p.status === params['status'] &&
                p.startDate > (params['date'] as string),
            )
            .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null
        );
      }),
      getCount: jest.fn(
        async () =>
          periods.filter(
            (p) =>
              p.fiscalYearId === params['yearId'] &&
              p.periodIndex < (params['index'] as number) &&
              p.status === params['status'],
          ).length,
      ),
      getMany: jest.fn(async () =>
        periods
          .filter((p) => p.endDate <= (params['date'] as string) && p.status === params['status'])
          .sort((a, b) => a.startDate.localeCompare(b.startDate)),
      ),
    };

    return qb;
  };
  const yearRepo = {
    find: jest.fn(async () => [...years].sort((a, b) => a.startDate.localeCompare(b.startDate))),
    findOne: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) => years.find((y) => matches(y as never, where)) ?? null,
    ),
    create: jest.fn((x: Partial<Year>) => ({ ...x })),
    save: jest.fn(async (x: Year) => {
      const saved = { ...x, id: `fy-${x.startDate}` };

      years.push(saved);

      return saved;
    }),
    update: jest.fn(async (id: string, patch: Partial<Year>) => {
      Object.assign(years.find((y) => y.id === id)!, patch);
    }),
  };
  const periodRepo = {
    findOne: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) => periods.find((p) => matches(p as never, where)) ?? null,
    ),
    find: jest.fn(async ({ where }: { where: { fiscalYearId: string } }) =>
      periods.filter((p) => p.fiscalYearId === where.fiscalYearId),
    ),
    create: jest.fn((x: Partial<Period>) => ({ status: AccountingPeriodStatus.OPEN, ...x })),
    save: jest.fn(async (x: Period) => {
      const saved = { ...x, id: `p-${x.fiscalYearId}-${x.periodIndex}` };

      periods.push(saved);

      return saved;
    }),
    update: jest.fn(async (criteria: string | Record<string, unknown>, patch: Partial<Period>) => {
      for (const p of periods.filter((row) =>
        typeof criteria === 'string' ? row.id === criteria : matches(row as never, criteria),
      )) {
        Object.assign(p, patch);
      }
    }),
    createQueryBuilder: jest.fn(() => periodQueryBuilder()),
  };
  const getRepository = (entity: unknown) =>
    entity === AccountingFiscalYearEntity ? yearRepo : entity === AccountingPeriodEntity ? periodRepo : null;
  const manager = {
    getRepository: jest.fn(getRepository),
    query: jest.fn(async (sql: string, params?: unknown[]) =>
      sql.includes('FOR SHARE') ? periods.filter((p) => p.id === params?.[0]).map((p) => ({ status: p.status })) : [],
    ),
  };
  const dataSource = {
    manager,
    getRepository: jest.fn(getRepository),
    query: jest.fn(async (_sql: string, _params?: unknown[]): Promise<unknown[]> => []),
    transaction: jest.fn(async (cb: (m: typeof manager) => Promise<unknown>) => await cb(manager)),
  };
  const config = { getConfig: jest.fn(() => settings) };
  const charts = {
    findChartByCode: jest.fn(async (): Promise<{ id: string } | null> => null),
    createFromTemplate: jest.fn(async () => ({ id: 'chart-default' })),
    getChart: jest.fn(async (id: string) => ({ id })),
  };
  const service = new AccountingFiscalYearService(dataSource as never, config as never, charts as never);
  const seedYear = (
    start: string,
    end: string,
    overrides: Partial<Year> = {},
    periodStatus: (index: number) => AccountingPeriodStatus = () => AccountingPeriodStatus.OPEN,
  ) => {
    const year: Year = {
      id: `fy-${start}`,
      name: start.slice(0, 4),
      startDate: start,
      endDate: end,
      chartId: 'c1',
      status: FiscalYearStatus.OPEN,
      ...overrides,
    };

    years.push(year);

    for (let i = 1; i <= 12; i += 1) {
      const month = String(i).padStart(2, '0');
      const startDate = `${start.slice(0, 4)}-${month}-01`;
      const endDate = new Date(Date.UTC(Number(start.slice(0, 4)), i, 0)).toISOString().slice(0, 10);

      periods.push({
        id: `p-${year.id}-${i}`,
        fiscalYearId: year.id,
        periodIndex: i,
        startDate,
        endDate,
        status: periodStatus(i),
      });
    }

    return year;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    years = [];
    periods = [];
    settings.startDate = '2026-01-01';
    settings.fiscalYearStartMonth = 1;
    charts.findChartByCode.mockResolvedValue(null);
  });

  describe('creating years and periods', () => {
    it('creates the first year from the bookkeeping start with the default chart template and twelve monthly periods', async () => {
      const year = await service.ensureYearForDate('2026-05-10', manager as never);

      expect(year).toEqual(
        expect.objectContaining({
          name: '2026',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          chartId: 'chart-default',
        }),
      );
      expect(charts.createFromTemplate).toHaveBeenCalledWith('DE-SKR03', {}, manager);
      expect(periods).toHaveLength(12);
      expect(periods[1]).toEqual(
        expect.objectContaining({ periodIndex: 2, startDate: '2026-02-01', endDate: '2026-02-28' }),
      );
      expect(periods[11]).toEqual(
        expect.objectContaining({ periodIndex: 12, startDate: '2026-12-01', endDate: '2026-12-31' }),
      );
      // Serialized against concurrent first postings and the entry-number sequence is initialized.
      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'));
      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('billing_accounting_entry_number_sequences'), [
        year.id,
      ]);
    });

    it('reuses an existing chart for the template and fills gap years with the previous chart', async () => {
      charts.findChartByCode.mockResolvedValue({ id: 'chart-existing' });

      const year = await service.ensureYearForDate('2028-02-29', manager as never);

      expect(charts.createFromTemplate).not.toHaveBeenCalled();
      expect(years.map((y) => [y.name, y.chartId])).toEqual([
        ['2026', 'chart-existing'],
        ['2027', 'chart-existing'],
        ['2028', 'chart-existing'],
      ]);
      expect(year.startDate).toBe('2028-01-01');
    });

    it('returns an existing year without locking or creating anything', async () => {
      seedYear('2026-01-01', '2026-12-31');

      await expect(service.ensureYearForDate('2026-07-01', manager as never)).resolves.toEqual(
        expect.objectContaining({ id: 'fy-2026-01-01' }),
      );

      expect(manager.query).not.toHaveBeenCalled();
      expect(yearRepo.save).not.toHaveBeenCalled();
    });

    it('creates a short first year and split names for a non-calendar fiscal year', async () => {
      settings.fiscalYearStartMonth = 7;

      await service.ensureYearForDate('2026-08-15', manager as never);

      expect(years.map((y) => [y.name, y.startDate, y.endDate])).toEqual([
        ['2026', '2026-01-01', '2026-06-30'],
        ['2026/27', '2026-07-01', '2027-06-30'],
      ]);
      expect(periods.filter((p) => p.fiscalYearId === 'fy-2026-01-01')).toHaveLength(6);
      expect(periods.filter((p) => p.fiscalYearId === 'fy-2026-07-01')).toHaveLength(12);
    });

    it('rejects dates before the bookkeeping start', async () => {
      await expect(service.ensureYearForDate('2025-12-31', manager as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(yearRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('chart changes (Jahresübernahme only)', () => {
    it('opens the next year with a newly chosen chart, validating that chart', async () => {
      seedYear('2026-01-01', '2026-12-31');

      const next = await service.openNextYear({ chartId: 'c2' });

      expect(charts.getChart).toHaveBeenCalledWith('c2', manager);
      expect(next).toEqual(expect.objectContaining({ startDate: '2027-01-01', endDate: '2027-12-31', chartId: 'c2' }));
    });

    it('inherits the previous chart and allows a short year but never more than twelve months', async () => {
      seedYear('2026-01-01', '2026-12-31');

      await expect(service.openNextYear({ endDate: '2028-01-31' })).rejects.toThrow(
        'A fiscal year must end within 12 months of its start',
      );
      await expect(service.openNextYear({ endDate: '2026-12-31' })).rejects.toBeInstanceOf(BadRequestException);

      const short = await service.openNextYear({ endDate: '2027-06-30' });

      expect(short).toEqual(expect.objectContaining({ chartId: 'c1', endDate: '2027-06-30' }));
      expect(periods.filter((p) => p.fiscalYearId === short.id)).toHaveLength(6);
    });

    it('rejects a second year with the same start', async () => {
      seedYear('2026-01-01', '2026-12-31');
      years.push({
        id: 'dup',
        name: '2027',
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        chartId: 'c1',
        status: FiscalYearStatus.OPEN,
      });
      // A concurrent writer created 2027 after the listing was read: the start-date check still catches it.
      yearRepo.find.mockResolvedValueOnce([years[0]]);

      await expect(service.openNextYear({})).rejects.toBeInstanceOf(ConflictException);
    });

    it('changes the chart of a year only while it has no bookings', async () => {
      seedYear('2027-01-01', '2027-12-31');
      dataSource.query.mockResolvedValueOnce([{ count: '3' }]);

      await expect(service.changeChartOfEmptyYear('fy-2027-01-01', 'c2')).rejects.toThrow(/cannot change/);
      expect(yearRepo.update).not.toHaveBeenCalled();

      dataSource.query.mockResolvedValueOnce([{ count: '0' }]);

      await expect(service.changeChartOfEmptyYear('fy-2027-01-01', 'c2')).resolves.toEqual(
        expect.objectContaining({ chartId: 'c2' }),
      );
      expect(charts.getChart).toHaveBeenCalledWith('c2');
    });

    it('throws NotFound for an unknown year', async () => {
      await expect(service.getYear('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('posting targets', () => {
    it('posts into the document period while it is open', async () => {
      seedYear('2026-01-01', '2026-12-31');

      const target = await service.resolvePostingTarget('2026-03-15', manager as never);

      expect(target.period.id).toBe('p-fy-2026-01-01-3');
      expect(target.postingDate).toBe('2026-03-15');
    });

    it('moves bookings for a locked period to the first open period after it', async () => {
      seedYear('2026-01-01', '2026-12-31', {}, (i) =>
        i <= 4 ? AccountingPeriodStatus.LOCKED : AccountingPeriodStatus.OPEN,
      );

      const target = await service.resolvePostingTarget('2026-03-15', manager as never);

      expect(target.period.id).toBe('p-fy-2026-01-01-5');
      expect(target.postingDate).toBe('2026-05-01');
    });

    it('moves bookings for a closed year into the next year', async () => {
      seedYear('2026-01-01', '2026-12-31', { status: FiscalYearStatus.CLOSED }, () => AccountingPeriodStatus.LOCKED);
      seedYear('2027-01-01', '2027-12-31');

      const target = await service.resolvePostingTarget('2026-11-30', manager as never);

      expect(target.fiscalYear.id).toBe('fy-2027-01-01');
      expect(target.period.periodIndex).toBe(1);
      expect(target.postingDate).toBe('2027-01-01');
    });

    it('holds a share lock on the target period and skips one that was locked meanwhile', async () => {
      seedYear('2026-01-01', '2026-12-31');
      // Period 3 was found open but got locked (Festschreibung) while this posting waited for the lock.
      manager.query.mockImplementation(async (sql: string, params?: unknown[]) =>
        sql.includes('FOR SHARE')
          ? [
              {
                status:
                  params?.[0] === 'p-fy-2026-01-01-3' ? AccountingPeriodStatus.LOCKED : AccountingPeriodStatus.OPEN,
              },
            ]
          : [],
      );

      try {
        const target = await service.resolvePostingTarget('2026-03-15', manager as never);

        expect(target.period.id).toBe('p-fy-2026-01-01-4');
        expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('FOR SHARE'), ['p-fy-2026-01-01-3']);
      } finally {
        manager.query.mockImplementation(async (sql: string, params?: unknown[]) =>
          sql.includes('FOR SHARE')
            ? periods.filter((p) => p.id === params?.[0]).map((p) => ({ status: p.status }))
            : [],
        );
      }
    });

    it('books documents dated before the bookkeeping start on the start date', async () => {
      seedYear('2026-01-01', '2026-12-31');

      await expect(service.resolvePostingTarget('2025-11-02', manager as never)).resolves.toEqual(
        expect.objectContaining({ postingDate: '2026-01-01' }),
      );
    });
  });

  describe('locking (Festschreibung)', () => {
    it('locks periods only in order and records who locked them', async () => {
      seedYear('2026-01-01', '2026-12-31');

      await expect(service.lockPeriod('p-fy-2026-01-01-2', 'admin')).rejects.toThrow(
        'Lock the earlier periods of the fiscal year first',
      );

      await service.lockPeriod('p-fy-2026-01-01-1', 'admin');

      const second = await service.lockPeriod('p-fy-2026-01-01-2', 'admin');

      expect(second).toEqual(
        expect.objectContaining({ status: AccountingPeriodStatus.LOCKED, lockedByUserId: 'admin' }),
      );
      expect(second.lockedAt).toBeInstanceOf(Date);
    });

    it('is idempotent for already locked periods and cannot be undone through lockPeriod', async () => {
      seedYear('2026-01-01', '2026-12-31', {}, (i) =>
        i === 1 ? AccountingPeriodStatus.LOCKED : AccountingPeriodStatus.OPEN,
      );

      const period = await service.lockPeriod('p-fy-2026-01-01-1', 'other');

      expect(period.status).toBe(AccountingPeriodStatus.LOCKED);
      expect(periodRepo.update).not.toHaveBeenCalled();
    });

    it('throws NotFound for an unknown period', async () => {
      await expect(service.lockPeriod('missing', null)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('locks all open periods through a date (VAT return submitted)', async () => {
      seedYear('2026-01-01', '2026-12-31');

      await expect(service.lockPeriodsThrough('2026-03-31', 'admin')).resolves.toBe(3);

      expect(periods.filter((p) => p.status === AccountingPeriodStatus.LOCKED).map((p) => p.periodIndex)).toEqual([
        1, 2, 3,
      ]);
    });

    it('closing a year locks its remaining open periods and marks it closed', async () => {
      seedYear('2026-01-01', '2026-12-31', {}, (i) =>
        i <= 6 ? AccountingPeriodStatus.LOCKED : AccountingPeriodStatus.OPEN,
      );

      await service.markClosed(manager as never, 'fy-2026-01-01', 'admin');

      expect(periods.every((p) => p.status === AccountingPeriodStatus.LOCKED)).toBe(true);
      expect(years[0]).toEqual(expect.objectContaining({ status: FiscalYearStatus.CLOSED, closedByUserId: 'admin' }));
    });
  });
});
