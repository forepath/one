import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';

import { AccountingPeriodStatus, FiscalYearStatus } from '../constants/accounting.constants';
import { AccountingFiscalYearEntity } from '../entities/accounting-fiscal-year.entity';
import { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import { addDays, addMonths, isoToday } from '../utils/accounting-date.util';

import { AccountingChartService } from './accounting-chart.service';
import { AccountingConfigService } from './accounting-config.service';

export interface PostingTarget {
  fiscalYear: AccountingFiscalYearEntity;
  period: AccountingPeriodEntity;
  /** Effective posting date (moved to the first open period when the document's period is locked/closed). */
  postingDate: string;
}

/**
 * Fiscal years and monthly periods. Years are contiguous; the first one starts at the bookkeeping start (a short
 * first year is allowed). A chart can only be chosen when a year is opened (no mid-year chart change). Locking a
 * period is final (Festschreibung).
 */
@Injectable()
export class AccountingFiscalYearService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
    private readonly charts: AccountingChartService,
  ) {}

  async listYears(manager?: EntityManager): Promise<AccountingFiscalYearEntity[]> {
    return await (manager ?? this.dataSource.manager)
      .getRepository(AccountingFiscalYearEntity)
      .find({ order: { startDate: 'ASC' } });
  }

  async getYear(id: string, manager?: EntityManager): Promise<AccountingFiscalYearEntity> {
    const year = await (manager ?? this.dataSource.manager)
      .getRepository(AccountingFiscalYearEntity)
      .findOne({ where: { id } });

    if (!year) {
      throw new NotFoundException('Fiscal year not found');
    }

    return year;
  }

  async listPeriods(fiscalYearId: string, manager?: EntityManager): Promise<AccountingPeriodEntity[]> {
    return await (manager ?? this.dataSource.manager)
      .getRepository(AccountingPeriodEntity)
      .find({ where: { fiscalYearId }, order: { periodIndex: 'ASC' } });
  }

  async findYearForDate(date: string, manager?: EntityManager): Promise<AccountingFiscalYearEntity | null> {
    return await (manager ?? this.dataSource.manager).getRepository(AccountingFiscalYearEntity).findOne({
      where: { startDate: LessThanOrEqual(date), endDate: MoreThanOrEqual(date) },
    });
  }

  /**
   * Fiscal year containing `date`, creating missing years from the bookkeeping start up to `date` (each new year
   * inherits the previous year's chart; the very first one uses the configured default template).
   */
  async ensureYearForDate(date: string, manager: EntityManager): Promise<AccountingFiscalYearEntity> {
    const existing = await this.findYearForDate(date, manager);

    if (existing) {
      return existing;
    }

    const { startDate } = this.config.getConfig();

    if (date < startDate) {
      throw new BadRequestException(`Date ${date} is before the bookkeeping start ${startDate}`);
    }

    // Serialize year creation (concurrent first postings).
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext('billing_accounting_fiscal_years'))`);

    const again = await this.findYearForDate(date, manager);

    if (again) {
      return again;
    }

    const years = await this.listYears(manager);
    let last = years[years.length - 1] ?? null;

    if (!last) {
      const chart = await this.ensureDefaultChart(manager);

      last = await this.createYearInternal(manager, startDate, this.defaultYearEnd(startDate), chart.id);
    }

    while (last.endDate < date) {
      const nextStart = addDays(last.endDate, 1);

      last = await this.createYearInternal(manager, nextStart, this.defaultYearEnd(nextStart), last.chartId);
    }

    if (date < years[0]?.startDate) {
      throw new BadRequestException(`No fiscal year covers ${date}`);
    }

    return (await this.findYearForDate(date, manager))!;
  }

  /**
   * Opens the next fiscal year explicitly (choose a different chart here — the only point where the chart may
   * change). `endDate` may shorten the year (Rumpfwirtschaftsjahr, max. 12 months).
   */
  async openNextYear(input: { chartId?: string; endDate?: string }): Promise<AccountingFiscalYearEntity> {
    return await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('billing_accounting_fiscal_years'))`);

      const years = await this.listYears(manager);
      const last = years[years.length - 1];
      let start: string;
      let chartId: string;

      if (last) {
        start = addDays(last.endDate, 1);
        chartId = input.chartId ?? last.chartId;
      } else {
        start = this.config.getConfig().startDate;
        chartId = input.chartId ?? (await this.ensureDefaultChart(manager)).id;
      }

      await this.charts.getChart(chartId, manager);

      const end = input.endDate ?? this.defaultYearEnd(start);

      if (end < start || end > addDays(addMonths(start, 12), -1)) {
        throw new BadRequestException('A fiscal year must end within 12 months of its start');
      }

      return await this.createYearInternal(manager, start, end, chartId);
    });
  }

  /** Changes the chart of a year that has no bookings yet (e.g. right after opening). */
  async changeChartOfEmptyYear(fiscalYearId: string, chartId: string): Promise<AccountingFiscalYearEntity> {
    const year = await this.getYear(fiscalYearId);
    const count: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(*)::text AS count FROM billing_accounting_journal_entries WHERE fiscal_year_id = $1`,
      [fiscalYearId],
    );

    if (Number(count[0]?.count ?? 0) > 0) {
      throw new BadRequestException(
        'The chart of a fiscal year with bookings cannot change; choose the new chart when opening the next year',
      );
    }

    await this.charts.getChart(chartId);
    await this.dataSource.getRepository(AccountingFiscalYearEntity).update(year.id, { chartId });

    return await this.getYear(year.id);
  }

  /**
   * Where a booking dated `documentDate` goes: its own period when open, otherwise the first open period after it
   * (late bookings into locked/closed periods are not allowed under GoBD).
   */
  async resolvePostingTarget(documentDate: string, manager: EntityManager): Promise<PostingTarget> {
    const effectiveDate =
      documentDate < this.config.getConfig().startDate ? this.config.getConfig().startDate : documentDate;
    let year = await this.ensureYearForDate(effectiveDate, manager);
    let candidateDate = effectiveDate;

    for (let guard = 0; guard < 48; guard += 1) {
      if (year.status === FiscalYearStatus.OPEN) {
        const period = await manager.getRepository(AccountingPeriodEntity).findOne({
          where: {
            fiscalYearId: year.id,
            startDate: LessThanOrEqual(candidateDate),
            endDate: MoreThanOrEqual(candidateDate),
          },
        });

        if (period && (await this.holdOpenPeriod(manager, period.id))) {
          return { fiscalYear: year, period, postingDate: candidateDate };
        }

        const nextOpen = await manager
          .getRepository(AccountingPeriodEntity)
          .createQueryBuilder('p')
          .where('p.fiscal_year_id = :yearId', { yearId: year.id })
          .andWhere('p.status = :status', { status: AccountingPeriodStatus.OPEN })
          .andWhere('p.start_date > :date', { date: candidateDate })
          .orderBy('p.startDate', 'ASC')
          .getOne();

        if (nextOpen) {
          if (await this.holdOpenPeriod(manager, nextOpen.id)) {
            return { fiscalYear: year, period: nextOpen, postingDate: nextOpen.startDate };
          }

          // Locked meanwhile: look further within the same year.
          candidateDate = nextOpen.startDate;
          continue;
        }
      }

      candidateDate = addDays(year.endDate, 1);
      year = await this.ensureYearForDate(candidateDate, manager);
    }

    throw new BadRequestException('No open accounting period found');
  }

  /**
   * Share-locks a period for the posting transaction and re-reads its status under the lock: locking (Festschreibung)
   * and the year-end closing take the period rows FOR UPDATE, so they wait for in-flight postings, and a posting that
   * waited behind them sees the period as no longer open.
   */
  private async holdOpenPeriod(manager: EntityManager, periodId: string): Promise<boolean> {
    const rows: Array<{ status: string }> = await manager.query(
      `SELECT status FROM billing_accounting_periods WHERE id = $1 FOR SHARE`,
      [periodId],
    );

    return rows[0]?.status === AccountingPeriodStatus.OPEN;
  }

  /** Festschreibung of a period (irreversible). Earlier periods of the year must be locked first. */
  async lockPeriod(periodId: string, userId: string | null): Promise<AccountingPeriodEntity> {
    return await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AccountingPeriodEntity);
      const period = await repo
        .createQueryBuilder('p')
        .where('p.id = :id', { id: periodId })
        .setLock('pessimistic_write')
        .getOne();

      if (!period) {
        throw new NotFoundException('Period not found');
      }

      if (period.status === AccountingPeriodStatus.LOCKED) {
        return period;
      }

      const openBefore = await repo
        .createQueryBuilder('p')
        .where('p.fiscal_year_id = :yearId', { yearId: period.fiscalYearId })
        .andWhere('p.period_index < :index', { index: period.periodIndex })
        .andWhere('p.status = :status', { status: AccountingPeriodStatus.OPEN })
        .getCount();

      if (openBefore > 0) {
        throw new BadRequestException('Lock the earlier periods of the fiscal year first');
      }

      await repo.update(period.id, {
        status: AccountingPeriodStatus.LOCKED,
        lockedAt: new Date(),
        lockedByUserId: userId,
      });

      return (await repo.findOne({ where: { id: period.id } }))!;
    });
  }

  /** Locks all periods up to and including `date` (used when a VAT return is submitted). */
  async lockPeriodsThrough(date: string, userId: string | null): Promise<number> {
    const periods = await this.dataSource
      .getRepository(AccountingPeriodEntity)
      .createQueryBuilder('p')
      .innerJoin(AccountingFiscalYearEntity, 'y', 'y.id = p.fiscal_year_id')
      .where('p.end_date <= :date', { date })
      .andWhere('p.status = :status', { status: AccountingPeriodStatus.OPEN })
      .orderBy('p.startDate', 'ASC')
      .getMany();

    for (const period of periods) {
      await this.lockPeriod(period.id, userId);
    }

    return periods.length;
  }

  async markClosed(manager: EntityManager, fiscalYearId: string, userId: string | null): Promise<void> {
    await manager
      .getRepository(AccountingPeriodEntity)
      .update(
        { fiscalYearId, status: AccountingPeriodStatus.OPEN },
        { status: AccountingPeriodStatus.LOCKED, lockedAt: new Date(), lockedByUserId: userId },
      );
    await manager
      .getRepository(AccountingFiscalYearEntity)
      .update(fiscalYearId, { status: FiscalYearStatus.CLOSED, closedAt: new Date(), closedByUserId: userId });
  }

  async ensureDefaultChart(manager: EntityManager) {
    const templateKey = this.config.getConfig().defaultChartTemplate;
    const existing = await this.charts.findChartByCode(templateKey, manager);

    return existing ?? (await this.charts.createFromTemplate(templateKey, {}, manager));
  }

  private defaultYearEnd(start: string): string {
    const { fiscalYearStartMonth } = this.config.getConfig();
    const [y, m] = start.split('-').map(Number);
    // End of the fiscal year containing `start` (first year may be short).
    const endYear = m >= fiscalYearStartMonth ? y + (fiscalYearStartMonth === 1 ? 0 : 1) : y;
    const endMonth = fiscalYearStartMonth === 1 ? 12 : fiscalYearStartMonth - 1;

    return addDays(addMonths(`${endYear}-${String(endMonth).padStart(2, '0')}-01`, 1), -1);
  }

  private async createYearInternal(
    manager: EntityManager,
    start: string,
    end: string,
    chartId: string,
  ): Promise<AccountingFiscalYearEntity> {
    const repo = manager.getRepository(AccountingFiscalYearEntity);

    if (await repo.findOne({ where: { startDate: start } })) {
      throw new ConflictException(`A fiscal year starting ${start} already exists`);
    }

    const year = await repo.save(
      repo.create({
        name: start.slice(0, 4) === end.slice(0, 4) ? start.slice(0, 4) : `${start.slice(0, 4)}/${end.slice(2, 4)}`,
        startDate: start,
        endDate: end,
        chartId,
        status: FiscalYearStatus.OPEN,
      }),
    );
    const periodRepo = manager.getRepository(AccountingPeriodEntity);
    let periodStart = start;
    let index = 1;

    while (periodStart <= end) {
      const monthEnd = addDays(addMonths(`${periodStart.slice(0, 7)}-01`, 1), -1);
      const periodEnd = monthEnd < end ? monthEnd : end;

      await periodRepo.save(
        periodRepo.create({ fiscalYearId: year.id, periodIndex: index, startDate: periodStart, endDate: periodEnd }),
      );
      periodStart = addDays(periodEnd, 1);
      index += 1;
    }

    await manager.query(
      `INSERT INTO billing_accounting_entry_number_sequences (fiscal_year_id, last_value) VALUES ($1, 0)
       ON CONFLICT (fiscal_year_id) DO NOTHING`,
      [year.id],
    );

    return year;
  }

  todayIso(): string {
    return isoToday();
  }
}
