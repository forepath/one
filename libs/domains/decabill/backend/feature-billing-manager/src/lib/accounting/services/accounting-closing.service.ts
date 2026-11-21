import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import {
  AccountingAccountRole as R,
  AccountingAccountType,
  FiscalYearStatus,
  JournalEntryKind,
  JournalLinkRole,
  JournalLinkType,
  JournalSourceType,
} from '../constants/accounting.constants';
import { AccountingAccountEntity } from '../entities/accounting-account.entity';
import { AccountingFiscalYearEntity } from '../entities/accounting-fiscal-year.entity';
import { addDays } from '../utils/accounting-date.util';
import { fromCents, toCents } from '../utils/accounting-money.util';

import { AccountingChartService } from './accounting-chart.service';
import { AccountingFiscalYearService } from './accounting-fiscal-year.service';
import { AccountingJournalService, type JournalLineInput } from './accounting-journal.service';

export interface CloseYearInput {
  /** Chart of the next year (only chosen when that year has no bookings yet — the chart-change point). */
  nextChartId?: string;
  /** Old account number → new account number for balances when the chart changes (default: same role, then an identical account by number). */
  accountMapping?: Record<string, string>;
}

/**
 * Year-end closing (Jahresübernahme): balance-sheet accounts and open items carry forward into the next year
 * against the carry-forward accounts, the result goes to retained earnings, and the closed year becomes immutable.
 */
@Injectable()
export class AccountingClosingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly fiscalYears: AccountingFiscalYearService,
    private readonly charts: AccountingChartService,
    private readonly journal: AccountingJournalService,
  ) {}

  /** Preview: balances and the mapping that would be used (unmapped accounts listed). */
  async preview(fiscalYearId: string, input: CloseYearInput) {
    const year = await this.fiscalYears.getYear(fiscalYearId);
    const next = await this.fiscalYears.findYearForDate(addDays(year.endDate, 1));
    const targetChartId = input.nextChartId ?? next?.chartId ?? year.chartId;
    const balances = await this.balanceSheetBalances(year);
    const mapping = await this.mapAccounts(
      year.chartId,
      targetChartId,
      balances.map((b) => b.account),
      input.accountMapping ?? {},
    );

    return {
      fiscalYear: year,
      targetChartId,
      chartChanges: targetChartId !== year.chartId,
      result: await this.result(year),
      balances: [...new Map(balances.map((b) => [b.account.id, b.account])).values()].map((account) => ({
        number: account.number,
        name: account.name,
        balance: fromCents(
          balances.filter((b) => b.account.id === account.id).reduce((sum, b) => sum + toCents(b.balance), 0),
        ),
        targetNumber: mapping.get(account.id)?.number ?? null,
      })),
      unmapped: [...new Set(balances.filter((b) => !mapping.has(b.account.id)).map((b) => b.account.number))],
    };
  }

  async close(fiscalYearId: string, input: CloseYearInput, userId: string | null): Promise<AccountingFiscalYearEntity> {
    const year = await this.fiscalYears.getYear(fiscalYearId);

    if (year.status !== FiscalYearStatus.OPEN) {
      throw new BadRequestException('Fiscal year is already closed');
    }

    const previous = await this.fiscalYears.findYearForDate(addDays(year.startDate, -1));

    if (previous && previous.status !== FiscalYearStatus.CLOSED) {
      throw new BadRequestException(`Close fiscal year ${previous.name} first`);
    }

    let next = await this.fiscalYears.findYearForDate(addDays(year.endDate, 1));

    if (!next) {
      next = await this.fiscalYears.openNextYear({ chartId: input.nextChartId });
    } else if (input.nextChartId && input.nextChartId !== next.chartId) {
      next = await this.fiscalYears.changeChartOfEmptyYear(next.id, input.nextChartId);
    }

    const nextYear = next;

    await this.dataSource.transaction(async (manager) => {
      // Lock the year's periods first: postings take a share lock on their period, so in-flight postings finish
      // before the figures are read, and later ones wait and then see the periods locked (→ next open period).
      await manager.query(`SELECT id FROM billing_accounting_periods WHERE fiscal_year_id = $1 FOR UPDATE`, [year.id]);

      const current = await manager.query(
        `SELECT status FROM billing_accounting_fiscal_years WHERE id = $1 FOR UPDATE`,
        [year.id],
      );

      if (current[0]?.status !== FiscalYearStatus.OPEN) {
        throw new BadRequestException('Fiscal year is already closed');
      }

      const balances = await this.balanceSheetBalances(year, manager);
      const mapping = await this.mapAccounts(
        year.chartId,
        nextYear.chartId,
        balances.map((b) => b.account),
        input.accountMapping ?? {},
      );
      const unmapped = [...new Set(balances.filter((b) => !mapping.has(b.account.id)).map((b) => b.account.number))];

      if (unmapped.length > 0) {
        throw new BadRequestException(
          `No account in the next year's chart for: ${unmapped.join(', ')} (provide a mapping)`,
        );
      }

      const openItems = await this.openItemBalances(year, manager);
      const results = await this.resultsByTenant(year, manager);
      const chartId = nextYear.chartId;
      const opening = (await this.charts.requireAccountByRole(chartId, R.OPENING_BALANCE, manager)).id;
      const openingAr = (await this.charts.requireAccountByRole(chartId, R.OPENING_BALANCE_RECEIVABLES, manager)).id;
      const openingAp = (await this.charts.requireAccountByRole(chartId, R.OPENING_BALANCE_PAYABLES, manager)).id;
      const retained = (await this.charts.requireAccountByRole(chartId, R.RETAINED_EARNINGS, manager)).id;
      const receivables = await this.charts.getAccountByRole(year.chartId, R.RECEIVABLES, manager);
      const payables = await this.charts.getAccountByRole(year.chartId, R.PAYABLES, manager);
      const lines: JournalLineInput[] = [];
      // Both sides keep the tenant dimension, so per-tenant balances open correctly in the next year.
      const pair = (accountId: string, contra: string, cents: number, extra: Partial<JournalLineInput> = {}): void => {
        if (cents === 0) {
          return;
        }

        lines.push({
          accountId,
          ...(cents > 0 ? { debit: fromCents(cents) } : { credit: fromCents(-cents) }),
          ...extra,
        });
        lines.push({
          accountId: contra,
          ...(cents > 0 ? { credit: fromCents(cents) } : { debit: fromCents(-cents) }),
          tenantId: extra.tenantId ?? null,
        });
      };

      for (const b of balances) {
        const target = mapping.get(b.account.id)!;

        // Receivables / payables carry forward per open item (OP-Vortrag) instead of one total.
        if (b.account.id === receivables?.id || b.account.id === payables?.id) {
          const isAr = b.account.id === receivables?.id;
          const items = openItems.filter(
            (i) => i.accountId === b.account.id && (i.tenantId ?? null) === (b.tenantId ?? null),
          );
          let itemized = 0;

          for (const item of items) {
            pair(target.id, isAr ? openingAr : openingAp, item.cents, {
              counterpartyType: item.counterpartyType as JournalLineInput['counterpartyType'],
              counterpartyId: item.counterpartyId,
              openItemId: item.openItemId,
              tenantId: item.tenantId,
            });
            itemized += item.cents;
          }

          pair(target.id, opening, toCents(b.balance) - itemized, { tenantId: b.tenantId });
          continue;
        }

        pair(target.id, opening, toCents(b.balance), { tenantId: b.tenantId });
      }

      // Profit increases equity (credit), loss decreases it.
      for (const r of results) {
        pair(retained, opening, -toCents(r.result), { tenantId: r.tenantId });
      }

      if (lines.length > 0) {
        await this.journal.post(
          {
            documentDate: nextYear.startDate,
            documentNumber: `EB ${nextYear.name}`,
            description: `Opening balances from fiscal year ${year.name}`,
            kind: JournalEntryKind.OPENING,
            sourceType: JournalSourceType.FISCAL_YEAR,
            sourceId: year.id,
            sourceEvent: 'carry_forward',
            idempotencyKey: `fiscal_year:${year.id}:carry_forward`,
            fiscalYearId: nextYear.id,
            createdByUserId: userId,
            lines,
            links: [
              {
                linkType: JournalLinkType.JOURNAL_ENTRY,
                targetId: year.id,
                role: JournalLinkRole.RELATED,
                label: `Fiscal year ${year.name}`,
              },
            ],
          },
          manager,
        );
      }

      await this.fiscalYears.markClosed(manager, year.id, userId);
    });

    return await this.fiscalYears.getYear(year.id);
  }

  /** Balance-sheet balances per account and tenant (the tenant is a posting dimension). */
  private async balanceSheetBalances(year: AccountingFiscalYearEntity, manager?: EntityManager) {
    const db = manager ?? this.dataSource.manager;
    const rows: Array<{ id: string; tenant_id: string | null; balance: string }> = await db.query(
      `SELECT l.account_id AS id, l.tenant_id, SUM(l.debit - l.credit) AS balance
       FROM billing_accounting_journal_lines l
       JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       JOIN billing_accounting_accounts a ON a.id = l.account_id
       WHERE e.fiscal_year_id = $1 AND a.type IN ('asset', 'liability', 'equity')
       GROUP BY l.account_id, l.tenant_id
       HAVING SUM(l.debit - l.credit) <> 0
          -- receivables / payables can net to zero while still holding offsetting open items (OP-Vortrag)
          OR (l.account_id, COALESCE(l.tenant_id, '')) IN (
            SELECT l2.account_id, COALESCE(l2.tenant_id, '') FROM billing_accounting_journal_lines l2
            JOIN billing_accounting_journal_entries e2 ON e2.id = l2.entry_id
            WHERE e2.fiscal_year_id = $1 AND l2.open_item_id IS NOT NULL
            GROUP BY l2.account_id, l2.tenant_id, l2.open_item_id
            HAVING SUM(l2.debit - l2.credit) <> 0
          )`,
      [year.id],
    );
    const accounts = await db.getRepository(AccountingAccountEntity).find({ where: { chartId: year.chartId } });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    return rows
      .filter((r) => byId.has(r.id))
      .map((r) => ({ account: byId.get(r.id)!, tenantId: r.tenant_id ?? null, balance: Number(r.balance) }));
  }

  private async openItemBalances(year: AccountingFiscalYearEntity, manager?: EntityManager) {
    const rows: Array<{
      account_id: string;
      open_item_id: string;
      counterparty_type: string | null;
      counterparty_id: string | null;
      tenant_id: string | null;
      balance: string;
    }> = await (manager ?? this.dataSource.manager).query(
      `SELECT l.account_id, l.open_item_id, MAX(l.counterparty_type) AS counterparty_type, MAX(l.counterparty_id) AS counterparty_id,
              MAX(l.tenant_id) AS tenant_id, SUM(l.debit - l.credit) AS balance
       FROM billing_accounting_journal_lines l
       JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       WHERE e.fiscal_year_id = $1 AND l.open_item_id IS NOT NULL
       GROUP BY l.account_id, l.open_item_id
       HAVING SUM(l.debit - l.credit) <> 0`,
      [year.id],
    );

    return rows.map((r) => ({
      accountId: r.account_id,
      openItemId: r.open_item_id,
      counterpartyType: r.counterparty_type,
      counterpartyId: r.counterparty_id,
      tenantId: r.tenant_id,
      cents: toCents(Number(r.balance)),
    }));
  }

  /** Year result per tenant (carried to retained earnings with its tenant dimension). */
  private async resultsByTenant(
    year: AccountingFiscalYearEntity,
    manager: EntityManager,
  ): Promise<Array<{ tenantId: string | null; result: number }>> {
    const rows: Array<{ tenant_id: string | null; result: string }> = await manager.query(
      `SELECT l.tenant_id, COALESCE(SUM(l.credit - l.debit), 0) AS result
       FROM billing_accounting_journal_lines l
       JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       JOIN billing_accounting_accounts a ON a.id = l.account_id
       WHERE e.fiscal_year_id = $1 AND a.type IN ('revenue', 'expense')
       GROUP BY l.tenant_id`,
      [year.id],
    );

    return rows.map((r) => ({ tenantId: r.tenant_id ?? null, result: Number(r.result) }));
  }

  private async result(year: AccountingFiscalYearEntity): Promise<number> {
    const rows: Array<{ result: string }> = await this.dataSource.query(
      `SELECT COALESCE(SUM(l.credit - l.debit), 0) AS result
       FROM billing_accounting_journal_lines l
       JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       JOIN billing_accounting_accounts a ON a.id = l.account_id
       WHERE e.fiscal_year_id = $1 AND a.type IN ('revenue', 'expense')`,
      [year.id],
    );

    return Number(rows[0]?.result ?? 0);
  }

  /**
   * Target accounts in the next year's chart: explicit mapping first; within the same chart the same number;
   * across charts the same role, then an identical account by number. Unmapped accounts are reported.
   */
  private async mapAccounts(
    fromChartId: string,
    toChartId: string,
    accounts: AccountingAccountEntity[],
    explicit: Record<string, string>,
  ): Promise<Map<string, AccountingAccountEntity>> {
    const targets = await this.charts.listAccounts(toChartId);
    const byNumber = new Map(targets.map((a) => [a.number, a]));
    const byRole = new Map(targets.filter((a) => a.role).map((a) => [a.role!, a]));
    const out = new Map<string, AccountingAccountEntity>();

    for (const account of accounts) {
      if (account.type === AccountingAccountType.STATISTICAL) {
        continue;
      }

      const mapped = explicit[account.number] ? byNumber.get(explicit[account.number]) : undefined;
      const sameNumber = byNumber.get(account.number);
      // Across charts a number alone means nothing (SKR03 1200 = bank, SKR04 1200 = receivables): only an identical
      // account (same type and name, e.g. a custom chart derived from the old one) is taken by number.
      const identical =
        sameNumber && sameNumber.type === account.type && sameNumber.name.trim() === account.name.trim()
          ? sameNumber
          : undefined;
      const target =
        mapped ??
        (fromChartId === toChartId ? sameNumber : undefined) ??
        (account.role ? byRole.get(account.role) : undefined) ??
        identical;

      if (target) {
        out.set(account.id, target);
      }
    }

    return out;
  }
}
