import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import {
  AccountingAccountRole as R,
  JournalEntryKind,
  JournalLinkRole,
  JournalLinkType,
  JournalSourceType,
} from '../constants/accounting.constants';
import { AccountingFixedAssetEntity, type FixedAssetMethod } from '../entities/accounting-fixed-asset.entity';
import { addDays, addMonths, endOfMonth } from '../utils/accounting-date.util';
import { fromCents, toCents } from '../utils/accounting-money.util';

import { AccountingChartService } from './accounting-chart.service';
import { AccountingConfigService } from './accounting-config.service';
import { AccountingFiscalYearService } from './accounting-fiscal-year.service';
import { AccountingJournalService } from './accounting-journal.service';

export interface CreateAssetInput {
  name: string;
  acquisitionDate: string;
  acquisitionCost: number;
  method?: FixedAssetMethod;
  usefulLifeMonths?: number;
  assetAccountNumber?: string | null;
  residualValue?: number;
  note?: string | null;
  tenantId?: string | null;
  supplierInvoiceId?: string | null;
  supplierInvoiceLineId?: string | null;
}

/**
 * Fixed asset register with straight-line depreciation (monthly pro rata from the acquisition month), immediate
 * write-off of low-value assets (GWG, limit configurable) and the optional German pool (Sammelposten, 1/5 per year).
 * Depreciation runs book one entry per asset; disposals book the remaining book value.
 */
@Injectable()
export class AccountingFixedAssetService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
    private readonly charts: AccountingChartService,
    private readonly fiscalYears: AccountingFiscalYearService,
    private readonly journal: AccountingJournalService,
  ) {}

  async list(params: { status?: string; tenantId?: string | null; limit: number; offset: number; search?: string }) {
    const qb = this.dataSource
      .getRepository(AccountingFixedAssetEntity)
      .createQueryBuilder('a')
      .orderBy('a.acquisitionDate', 'DESC')
      .take(params.limit)
      .skip(params.offset);

    if (params.status) {
      qb.andWhere('a.status = :status', { status: params.status });
    }

    if (params.search) {
      const term = `%${params.search.replace(/[%_\\]/g, '\\$&')}%`;

      qb.andWhere('(a.asset_number ILIKE :term OR a.name ILIKE :term)', { term });
    }

    if (params.tenantId !== undefined && params.tenantId !== null) {
      qb.andWhere('a.tenant_id = :tenantId', { tenantId: params.tenantId });
    }

    const [items, total] = await qb.getManyAndCount();

    return { items, total };
  }

  async get(id: string): Promise<AccountingFixedAssetEntity> {
    const asset = await this.dataSource.getRepository(AccountingFixedAssetEntity).findOne({ where: { id } });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    return asset;
  }

  /** Classifies an acquisition: GWG (immediate), pool (if enabled) or straight-line. */
  classify(netCost: number, requested?: FixedAssetMethod): { method: FixedAssetMethod; role: R } {
    const cfg = this.config.getConfig();

    if (requested === 'straight_line') {
      return { method: 'straight_line', role: R.FIXED_ASSETS };
    }

    if (netCost <= cfg.gwgLimit) {
      return { method: 'immediate', role: R.LOW_VALUE_ASSETS };
    }

    if (cfg.assetPoolEnabled && netCost > cfg.assetPoolLower && netCost <= cfg.assetPoolUpper) {
      return { method: 'pool', role: R.ASSET_POOL };
    }

    return { method: requested ?? 'straight_line', role: R.FIXED_ASSETS };
  }

  /** Creates the register entry (acquisition is booked by its source document — supplier invoice or opening balance). */
  async create(input: CreateAssetInput, manager?: EntityManager): Promise<AccountingFixedAssetEntity> {
    const m = manager ?? this.dataSource.manager;

    if (!input.name?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.acquisitionDate) || !(input.acquisitionCost >= 0)) {
      throw new BadRequestException('Name, acquisition date and cost are required');
    }

    const { method, role } = this.classify(input.acquisitionCost, input.method);
    const life = method === 'immediate' ? 0 : method === 'pool' ? 60 : (input.usefulLifeMonths ?? 36);

    if (method === 'straight_line' && (life < 1 || life > 1200)) {
      throw new BadRequestException('Useful life must be 1–1200 months');
    }

    let accountNumber = input.assetAccountNumber ?? null;

    if (!accountNumber) {
      const year = await this.fiscalYears.ensureYearForDate(
        input.acquisitionDate < this.config.getConfig().startDate
          ? this.config.getConfig().startDate
          : input.acquisitionDate,
        m,
      );

      accountNumber = (await this.charts.requireAccountByRole(year.chartId, role, m)).number;
    }

    const rows: Array<{ n: string }> = await m.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(asset_number, '\\D', '', 'g'), '')::int), 0) + 1 AS n
       FROM billing_accounting_fixed_assets`,
    );
    const repo = m.getRepository(AccountingFixedAssetEntity);

    return await repo.save(
      repo.create({
        tenantId: input.tenantId ?? null,
        assetNumber: `AST-${String(rows[0]?.n ?? 1).padStart(5, '0')}`,
        name: input.name.trim().slice(0, 255),
        acquisitionDate: input.acquisitionDate,
        acquisitionCost: input.acquisitionCost,
        method,
        usefulLifeMonths: life,
        assetAccountNumber: accountNumber,
        residualValue: input.residualValue ?? 0,
        accumulatedDepreciation: 0,
        status: 'active',
        supplierInvoiceId: input.supplierInvoiceId ?? null,
        supplierInvoiceLineId: input.supplierInvoiceLineId ?? null,
        note: input.note ?? null,
      }),
    );
  }

  /** Depreciation planned for one asset up to and including month `through` (YYYY-MM), from where it stands. */
  plannedDepreciation(asset: AccountingFixedAssetEntity, through: string): Array<{ month: string; amount: number }> {
    const cost = toCents(Number(asset.acquisitionCost)) - toCents(Number(asset.residualValue));
    let done = toCents(Number(asset.accumulatedDepreciation));
    const firstMonth = asset.acquisitionDate.slice(0, 7);
    const startMonth = asset.depreciatedThrough
      ? addMonths(`${asset.depreciatedThrough}-01`, 1).slice(0, 7)
      : firstMonth;
    const out: Array<{ month: string; amount: number }> = [];

    if (asset.status !== 'active' || startMonth > through || done >= cost) {
      return out;
    }

    if (asset.method === 'immediate') {
      out.push({ month: firstMonth > through ? through : firstMonth, amount: fromCents(cost - done) });

      return out;
    }

    for (let month = startMonth; month <= through && done < cost; month = addMonths(`${month}-01`, 1).slice(0, 7)) {
      let amount: number;

      if (asset.method === 'pool') {
        // Sammelposten: 1/5 per calendar year, booked in December (or the last run month of the year).
        if (month.slice(5, 7) !== '12') {
          continue;
        }

        amount = Math.min(Math.round(cost / 5), cost - done);
      } else {
        const monthIndex = this.monthsBetween(firstMonth, month);
        const planned = Math.round((cost * (monthIndex + 1)) / asset.usefulLifeMonths);

        amount = Math.min(planned, cost) - done;
      }

      if (amount > 0) {
        out.push({ month, amount: fromCents(amount) });
        done += amount;
      }
    }

    return out;
  }

  /** Books depreciation of all active assets up to month `through` (YYYY-MM): one entry per asset. */
  async runDepreciation(through: string, userId: string | null): Promise<{ assets: number; amount: number }> {
    if (!/^\d{4}-\d{2}$/.test(through)) {
      throw new BadRequestException('Month must be YYYY-MM');
    }

    const assets = await this.dataSource
      .getRepository(AccountingFixedAssetEntity)
      .find({ where: { status: 'active' } });
    let count = 0;
    let total = 0;

    for (const asset of assets) {
      if (this.plannedDepreciation(asset, through).length === 0) {
        continue;
      }

      const bookedCents = await this.runDepreciationForAsset(asset, through, userId);

      if (bookedCents > 0) {
        count += 1;
        total += bookedCents;
      }
    }

    return { assets: count, amount: fromCents(total) };
  }

  /** Disposes an asset: depreciation up to the disposal month, then the remaining book value is written off. */
  async dispose(
    id: string,
    input: { date: string; note?: string | null },
    userId: string | null,
  ): Promise<AccountingFixedAssetEntity> {
    const asset = await this.get(id);

    if (asset.status === 'disposed') {
      throw new BadRequestException('Asset already disposed');
    }

    if (input.date < asset.acquisitionDate) {
      throw new BadRequestException('Disposal date is before the acquisition');
    }

    if (asset.status === 'active') {
      await this.runSingle(asset, addMonths(`${input.date.slice(0, 7)}-01`, -1).slice(0, 7), userId);
    }

    const fresh = await this.get(id);
    const bookValue = toCents(Number(fresh.acquisitionCost)) - toCents(Number(fresh.accumulatedDepreciation));

    await this.dataSource.transaction(async (manager) => {
      if (bookValue > 0) {
        const target = await this.fiscalYears.resolvePostingTarget(input.date, manager);
        const chartId = target.fiscalYear.chartId;
        const loss = await this.charts.requireAccountByRole(chartId, R.ASSET_DISPOSAL_LOSS, manager);
        const assetAccount = await this.charts.findAccountByNumber(chartId, fresh.assetAccountNumber, manager);

        if (!assetAccount) {
          throw new BadRequestException(`Asset account ${fresh.assetAccountNumber} is missing in the chart`);
        }

        await this.journal.post(
          {
            documentDate: input.date,
            documentNumber: fresh.assetNumber,
            description: `Disposal ${fresh.assetNumber} ${fresh.name} (book value)`.slice(0, 255),
            kind: JournalEntryKind.AUTOMATIC,
            sourceType: JournalSourceType.FIXED_ASSET,
            sourceId: fresh.id,
            sourceEvent: 'disposal',
            idempotencyKey: `fixed_asset:${fresh.id}:disposal`,
            tenantId: fresh.tenantId,
            createdByUserId: userId,
            lines: [
              { accountId: loss.id, debit: fromCents(bookValue), tenantId: fresh.tenantId },
              { accountId: assetAccount.id, credit: fromCents(bookValue), tenantId: fresh.tenantId },
            ],
            links: [{ linkType: JournalLinkType.FIXED_ASSET, targetId: fresh.id, role: JournalLinkRole.SOURCE }],
          },
          manager,
        );
      }

      await manager.getRepository(AccountingFixedAssetEntity).update(id, {
        status: 'disposed',
        disposalDate: input.date,
        note: input.note ?? fresh.note ?? null,
      });
    });

    return await this.get(id);
  }

  /** Asset schedule (Anlagenspiegel) for a fiscal year: opening cost, additions, disposals, depreciation, book values. */
  async schedule(from: string, to: string) {
    const assets = await this.dataSource
      .getRepository(AccountingFixedAssetEntity)
      .find({ order: { assetNumber: 'ASC' } });
    const depreciation: Array<{ source_id: string; before: string; during: string }> = await this.dataSource.query(
      `SELECT e.source_id,
              SUM(CASE WHEN e.posting_date < $1 THEN e.total ELSE 0 END) AS before,
              SUM(CASE WHEN e.posting_date >= $1 AND e.posting_date <= $2 THEN e.total ELSE 0 END) AS during
       FROM billing_accounting_journal_entries e
       WHERE e.source_type = 'fixed_asset' AND e.kind = 'depreciation' AND e.reversal_of_entry_id IS NULL
       GROUP BY e.source_id`,
      [from, to],
    );
    const dep = new Map(depreciation.map((d) => [d.source_id, d]));

    return assets
      .filter((a) => a.acquisitionDate <= to && (!a.disposalDate || a.disposalDate >= from))
      .map((a) => {
        const d = dep.get(a.id);
        const cost = Number(a.acquisitionCost);
        const before = Number(d?.before ?? 0);
        const during = Number(d?.during ?? 0);
        const addition = a.acquisitionDate >= from ? cost : 0;
        const disposal = a.disposalDate && a.disposalDate <= to ? cost : 0;

        return {
          id: a.id,
          assetNumber: a.assetNumber,
          name: a.name,
          accountNumber: a.assetAccountNumber,
          method: a.method,
          acquisitionDate: a.acquisitionDate,
          openingCost: addition ? 0 : cost,
          additions: addition,
          disposals: disposal,
          closingCost: fromCents(toCents(addition ? 0 : cost) + toCents(addition) - toCents(disposal)),
          openingDepreciation: before,
          depreciation: during,
          openingBookValue: addition ? 0 : fromCents(toCents(cost) - toCents(before)),
          closingBookValue: disposal ? 0 : fromCents(toCents(cost) - toCents(before) - toCents(during)),
        };
      });
  }

  async findBySupplierLines(lineIds: string[]): Promise<AccountingFixedAssetEntity[]> {
    if (lineIds.length === 0) {
      return [];
    }

    return await this.dataSource
      .getRepository(AccountingFixedAssetEntity)
      .find({ where: { supplierInvoiceLineId: In(lineIds) } });
  }

  private async runSingle(asset: AccountingFixedAssetEntity, through: string, userId: string | null): Promise<void> {
    if (this.plannedDepreciation(asset, through).length > 0) {
      await this.runDepreciationFor([asset.id], through, userId);
    }
  }

  private async runDepreciationFor(ids: string[], through: string, userId: string | null): Promise<void> {
    const original = this.dataSource.getRepository(AccountingFixedAssetEntity);
    const assets = await original.find({ where: { id: In(ids) } });

    for (const asset of assets) {
      if (this.plannedDepreciation(asset, through).length > 0) {
        await this.runDepreciationForAsset(asset, through, userId);
      }
    }
  }

  /**
   * Books the planned depreciation of one asset through `through`: one entry per month, each in its own period (a
   * catch-up over a year end must not move last year's depreciation into this year). The asset row is locked and the
   * plan recomputed inside the transaction, so concurrent runs cannot depreciate the same months twice.
   */
  private async runDepreciationForAsset(
    asset: AccountingFixedAssetEntity,
    through: string,
    userId: string | null,
  ): Promise<number> {
    return await this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .getRepository(AccountingFixedAssetEntity)
        .createQueryBuilder('a')
        .where('a.id = :id', { id: asset.id })
        .setLock('pessimistic_write')
        .getOne();

      if (!locked || locked.status !== 'active') {
        return 0;
      }

      const plan = this.plannedDepreciation(locked, through);
      let accumulatedCents = toCents(Number(locked.accumulatedDepreciation));
      let bookedCents = 0;

      for (const { month, amount } of plan) {
        const cents = toCents(amount);

        if (cents <= 0) {
          continue;
        }

        const date = endOfMonth(`${month}-01`);
        const target = await this.fiscalYears.resolvePostingTarget(date, manager);
        const depreciation = await this.charts.requireAccountByRole(target.fiscalYear.chartId, R.DEPRECIATION, manager);
        const assetAccount = await this.charts.findAccountByNumber(
          target.fiscalYear.chartId,
          locked.assetAccountNumber,
          manager,
        );

        if (!assetAccount) {
          throw new BadRequestException(`Asset account ${locked.assetAccountNumber} is missing in the chart`);
        }

        await this.journal.post(
          {
            documentDate: date,
            documentNumber: locked.assetNumber,
            description: `Depreciation ${locked.assetNumber} ${locked.name} ${month}`.slice(0, 255),
            kind: JournalEntryKind.DEPRECIATION,
            sourceType: JournalSourceType.FIXED_ASSET,
            sourceId: locked.id,
            sourceEvent: `depreciation_${month}`,
            idempotencyKey: `fixed_asset:${locked.id}:depreciation:${month}`,
            tenantId: locked.tenantId,
            createdByUserId: userId,
            lines: [
              { accountId: depreciation.id, debit: fromCents(cents), tenantId: locked.tenantId },
              { accountId: assetAccount.id, credit: fromCents(cents), tenantId: locked.tenantId },
            ],
            links: [{ linkType: JournalLinkType.FIXED_ASSET, targetId: locked.id, role: JournalLinkRole.SOURCE }],
          },
          manager,
        );
        accumulatedCents += cents;
        bookedCents += cents;
      }

      if (plan.length > 0) {
        const depreciable = toCents(Number(locked.acquisitionCost)) - toCents(Number(locked.residualValue));

        await manager.getRepository(AccountingFixedAssetEntity).update(locked.id, {
          accumulatedDepreciation: fromCents(accumulatedCents),
          depreciatedThrough: plan[plan.length - 1].month,
          status: accumulatedCents >= depreciable ? 'fully_depreciated' : 'active',
        });
      }

      return bookedCents;
    });
  }

  private monthsBetween(from: string, to: string): number {
    const [fy, fm] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);

    return (ty - fy) * 12 + (tm - fm);
  }

  /** Last day before a date (helper for schedules). */
  dayBefore(date: string): string {
    return addDays(date, -1);
  }
}
