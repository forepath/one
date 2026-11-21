import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  AccountingAccountType,
  BALANCE_SHEET_ACCOUNT_TYPES,
  CounterpartyType,
  PROFIT_AND_LOSS_ACCOUNT_TYPES,
} from '../constants/accounting.constants';
import { AccountingAccountEntity } from '../entities/accounting-account.entity';
import type { StatementLayout, StatementLayoutLine } from '../profiles/accounting-profile.types';
import { addDays } from '../utils/accounting-date.util';
import { fromCents, toCents } from '../utils/accounting-money.util';

import { AccountingConfigService } from './accounting-config.service';
import { AccountingFiscalYearService } from './accounting-fiscal-year.service';

/** `null` = all tenants (global view); otherwise only lines of that tenant dimension. */
export type TenantFilter = string | null;

export interface TrialBalanceRow {
  accountId: string;
  number: string;
  name: string;
  type: AccountingAccountType;
  statementPosition: string | null;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

export interface StatementNode {
  code: string;
  label: string;
  amount: number;
  previousAmount?: number;
  accounts: Array<{ number: string; name: string; amount: number }>;
  children: StatementNode[];
}

export interface StatementReport {
  layoutKey: string;
  name: string;
  from: string;
  to: string;
  sections: Array<{ key: string; label: string; nodes: StatementNode[]; total: number }>;
  result: number;
  /** Accounts with balances but no statement position (shown so nothing silently disappears). */
  unassigned: Array<{ number: string; name: string; amount: number }>;
}

export interface OpenItemRow {
  openItemId: string;
  counterpartyId: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  dueDate: string | null;
  amount: number;
  open: number;
  daysOverdue: number;
  tenantId: string | null;
}

const AGING_BUCKETS = [
  { key: 'current', max: 0 },
  { key: '1-30', max: 30 },
  { key: '31-60', max: 60 },
  { key: '61-90', max: 90 },
  { key: '90+', max: Number.POSITIVE_INFINITY },
] as const;

/** Read-side reports over the journal (all amounts in functional currency). */
@Injectable()
export class AccountingReportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
    private readonly fiscalYears: AccountingFiscalYearService,
  ) {}

  /** Trial balance (Summen- und Saldenliste) for the chart of the fiscal year containing `from`. */
  async trialBalance(from: string, to: string, tenant: TenantFilter): Promise<TrialBalanceRow[]> {
    this.assertRange(from, to);

    const year = await this.fiscalYears.findYearForDate(from);

    if (!year) {
      return [];
    }

    const params: unknown[] = [year.chartId, year.startDate, from, to];
    const tenantSql = tenant !== null ? `AND l.tenant_id = $${params.push(tenant)}` : '';
    const rows: Array<{
      id: string;
      number: string;
      name: string;
      type: AccountingAccountType;
      statement_position: string | null;
      opening: string;
      debit: string;
      credit: string;
    }> = await this.dataSource.query(
      `SELECT a.id, a.number, a.name, a.type, a.statement_position,
              COALESCE(SUM(CASE WHEN e.posting_date < $3 THEN l.debit - l.credit ELSE 0 END), 0) AS opening,
              COALESCE(SUM(CASE WHEN e.posting_date >= $3 THEN l.debit ELSE 0 END), 0) AS debit,
              COALESCE(SUM(CASE WHEN e.posting_date >= $3 THEN l.credit ELSE 0 END), 0) AS credit
       FROM billing_accounting_accounts a
       JOIN billing_accounting_journal_lines l ON l.account_id = a.id
       JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       WHERE a.chart_id = $1 AND e.posting_date >= $2 AND e.posting_date <= $4 ${tenantSql}
       GROUP BY a.id
       ORDER BY a.number`,
      params,
    );

    return rows.map((r) => {
      const opening = Number(r.opening);
      const debit = Number(r.debit);
      const credit = Number(r.credit);

      return {
        accountId: r.id,
        number: r.number,
        name: r.name,
        type: r.type,
        statementPosition: r.statement_position,
        opening,
        debit,
        credit,
        closing: fromCents(toCents(opening) + toCents(debit) - toCents(credit)),
      };
    });
  }

  /** Account statement (Kontoblatt): lines with running balance. */
  async accountLedger(
    accountId: string,
    from: string,
    to: string,
    tenant: TenantFilter,
    limit: number,
    offset: number,
  ): Promise<{
    account: AccountingAccountEntity;
    opening: number;
    items: Array<Record<string, unknown>>;
    total: number;
    closing: number;
  }> {
    this.assertRange(from, to);

    const account = await this.dataSource
      .getRepository(AccountingAccountEntity)
      .findOneOrFail({ where: { id: accountId } });
    const year = await this.fiscalYears.findYearForDate(from);
    const yearStart = year?.startDate ?? from;
    const base: unknown[] = [accountId];
    const tenantSql = tenant !== null ? `AND l.tenant_id = $${base.push(tenant)}` : '';
    const openingRows: Array<{ balance: string }> = await this.dataSource.query(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS balance
       FROM billing_accounting_journal_lines l JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       WHERE l.account_id = $1 ${tenantSql} AND e.posting_date >= $${base.length + 1} AND e.posting_date < $${base.length + 2}`,
      [...base, yearStart, from],
    );
    const opening = Number(openingRows[0]?.balance ?? 0);
    const countRows: Array<{ count: string; closing: string }> = await this.dataSource.query(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(l.debit - l.credit), 0) AS closing
       FROM billing_accounting_journal_lines l JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       WHERE l.account_id = $1 ${tenantSql} AND e.posting_date >= $${base.length + 1} AND e.posting_date <= $${base.length + 2}`,
      [...base, from, to],
    );
    const items: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT e.id AS "entryId", e.entry_number AS "entryNumber", e.posting_date AS "postingDate",
              e.document_date AS "documentDate", e.document_number AS "documentNumber", e.description,
              e.source_type AS "sourceType", e.kind, l.debit::float AS debit, l.credit::float AS credit,
              l.counterparty_type AS "counterpartyType", l.counterparty_id AS "counterpartyId", l.tenant_id AS "tenantId",
              l.tax_rate::float AS "taxRate", l.description AS "lineDescription",
              SUM(l.debit - l.credit) OVER (ORDER BY e.posting_date, e.entry_number, l.line_no)::float AS running
       FROM billing_accounting_journal_lines l JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       WHERE l.account_id = $1 ${tenantSql} AND e.posting_date >= $${base.length + 1} AND e.posting_date <= $${base.length + 2}
       ORDER BY e.posting_date, e.entry_number, l.line_no
       LIMIT $${base.length + 3} OFFSET $${base.length + 4}`,
      [...base, from, to, limit, offset],
    );

    for (const item of items) {
      item['running'] = fromCents(toCents(opening) + toCents(Number(item['running'])));
    }

    return {
      account,
      opening,
      items,
      total: Number(countRows[0]?.count ?? 0),
      closing: fromCents(toCents(opening) + toCents(Number(countRows[0]?.closing ?? 0))),
    };
  }

  /** Open items (OP-Liste) of customers or suppliers as of a date, with aging. */
  async openItems(
    type: CounterpartyType,
    asOf: string,
    tenant: TenantFilter,
  ): Promise<{ items: OpenItemRow[]; aging: Record<string, number>; total: number }> {
    const sign = type === CounterpartyType.CUSTOMER ? 1 : -1;
    const params: unknown[] = [type, asOf];
    const tenantSql = tenant !== null ? `AND l.tenant_id = $${params.push(tenant)}` : '';
    const docJoin =
      type === CounterpartyType.CUSTOMER
        ? `LEFT JOIN billing_invoices d ON d.id = l.open_item_id`
        : `LEFT JOIN billing_supplier_invoices d ON d.id = l.open_item_id`;
    const docDate =
      type === CounterpartyType.CUSTOMER ? `d.issued_at::date` : `COALESCE(d.issue_date, d.issued_at::date)`;
    const rows: Array<{
      open_item_id: string;
      counterparty_id: string | null;
      number: string | null;
      doc_date: string | null;
      due_date: string | null;
      amount: string;
      open: string;
      tenant_id: string | null;
    }> = await this.dataSource.query(
      `SELECT l.open_item_id, MAX(l.counterparty_id) AS counterparty_id, MAX(d.invoice_number) AS number,
              MAX(${docDate})::text AS doc_date, MAX(d.due_date)::text AS due_date,
              MAX(d.total_gross) AS amount, SUM(l.debit - l.credit) AS open, MAX(l.tenant_id) AS tenant_id
       FROM billing_accounting_journal_lines l
       JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       ${docJoin}
       WHERE l.counterparty_type = $1 AND l.open_item_id IS NOT NULL AND e.posting_date <= $2 ${tenantSql}
         -- A closed year's items live on in the next year's opening entry (OP-Vortrag): once that carry-forward is
         -- in effect for asOf, the closed year's own lines must not be counted again.
         AND NOT EXISTS (
           SELECT 1 FROM billing_accounting_journal_entries cf
           JOIN billing_accounting_fiscal_years fy ON fy.id = e.fiscal_year_id
           WHERE cf.source_type = 'fiscal_year' AND cf.source_event = 'carry_forward' AND cf.source_id = fy.id::text
             AND cf.reversed_by_entry_id IS NULL AND cf.posting_date <= $2 AND fy.end_date < $2
         )
       GROUP BY l.open_item_id
       HAVING SUM(l.debit - l.credit) <> 0
       ORDER BY MAX(d.due_date) NULLS LAST`,
      params,
    );
    const aging: Record<string, number> = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0]));
    const asOfTime = Date.parse(`${asOf}T00:00:00Z`);
    const items = rows.map((r) => {
      const open = fromCents(sign * toCents(Number(r.open)));
      const daysOverdue = r.due_date
        ? Math.max(0, Math.floor((asOfTime - Date.parse(`${r.due_date.slice(0, 10)}T00:00:00Z`)) / 86_400_000))
        : 0;
      const bucket = AGING_BUCKETS.find((b) => daysOverdue <= b.max)!;

      aging[bucket.key] = fromCents(toCents(aging[bucket.key]) + toCents(open));

      return {
        openItemId: r.open_item_id,
        counterpartyId: r.counterparty_id,
        documentNumber: r.number,
        documentDate: r.doc_date,
        dueDate: r.due_date ? r.due_date.slice(0, 10) : null,
        amount: Number(r.amount ?? 0),
        open,
        daysOverdue,
        tenantId: r.tenant_id,
      };
    });

    return { items, aging, total: fromCents(items.reduce((s, i) => s + toCents(i.open), 0)) };
  }

  /** Balance sheet as of `asOf` (fiscal year start → asOf), result of the year as its own equity position. */
  async balanceSheet(asOf: string, tenant: TenantFilter, compareToPreviousYear = true): Promise<StatementReport> {
    this.assertRange(asOf, asOf);

    const year = await this.fiscalYears.findYearForDate(asOf);

    if (!year) {
      throw new BadRequestException(`No fiscal year covers ${asOf}`);
    }

    const layout = this.config.getConfig().profile.balanceSheet;
    const balances = await this.balancesByAccount(year.chartId, year.startDate, asOf, tenant);
    const previous = compareToPreviousYear ? await this.previousYearBalances(year.startDate, tenant, 'bs') : null;
    const result = this.resultOf(balances);
    const assets = this.buildNodes(layout.assets ?? [], balances, (a) => a.debitMinusCredit, previous);
    const equity = this.buildNodes(layout.equityAndLiabilities ?? [], balances, (a) => -a.debitMinusCredit, previous);

    if (layout.resultPosition) {
      this.addToPosition(equity, layout.resultPosition, result);
    }

    return {
      layoutKey: layout.key,
      name: layout.name,
      from: year.startDate,
      to: asOf,
      sections: [
        { key: 'assets', label: 'Assets', nodes: assets, total: this.sumNodes(assets) },
        { key: 'equityAndLiabilities', label: 'Equity and liabilities', nodes: equity, total: this.sumNodes(equity) },
      ],
      result,
      unassigned: this.unassigned(balances, layout, BALANCE_SHEET_ACCOUNT_TYPES),
    };
  }

  /** Profit and loss for a date range. */
  async profitAndLoss(from: string, to: string, tenant: TenantFilter): Promise<StatementReport> {
    this.assertRange(from, to);

    const year = await this.fiscalYears.findYearForDate(from);

    if (!year) {
      throw new BadRequestException(`No fiscal year covers ${from}`);
    }

    const layout = this.config.getConfig().profile.profitAndLoss;
    const balances = await this.balancesByAccount(year.chartId, from, to, tenant);
    const nodes = this.buildPlNodes(layout.lines ?? [], balances, (a) => a.statementPosition);

    return {
      layoutKey: layout.key,
      name: layout.name,
      from,
      to,
      sections: [{ key: 'lines', label: layout.name, nodes, total: this.resultOf(balances) }],
      result: this.resultOf(balances),
      unassigned: this.unassigned(balances, layout, PROFIT_AND_LOSS_ACCOUNT_TYPES),
    };
  }

  /**
   * Cash-basis profit (EÜR and equivalents): revenue/expenses counted when paid. Payments of invoices are allocated
   * proportionally to the invoice's revenue/VAT lines; postings directly between cash and P&L accounts (fees,
   * manual entries) count as they are; depreciation counts in its period.
   */
  async cashBasis(from: string, to: string, tenant: TenantFilter): Promise<StatementReport> {
    this.assertRange(from, to);

    const profile = this.config.getConfig().profile;
    const layout = profile.cashBasis;

    if (!layout) {
      throw new BadRequestException(`The ${profile.country} profile has no cash-basis statement`);
    }

    const params: unknown[] = [from, to];
    const tenantSql = tenant !== null ? `AND e.tenant_id = $${params.push(tenant)}` : '';
    // 1) Payments settling open items: share = paid / document total, applied to the document entry's P&L + VAT lines.
    const allocated: Array<{ account_id: string; amount: string }> = await this.dataSource.query(
      `WITH pay AS (
         SELECT l.open_item_id, SUM(CASE WHEN l.counterparty_type = 'customer' THEN l.credit - l.debit ELSE l.debit - l.credit END) AS paid
         FROM billing_accounting_journal_lines l JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
         WHERE e.source_type = 'settlement' AND l.open_item_id IS NOT NULL
           AND e.posting_date >= $1 AND e.posting_date <= $2 ${tenantSql}
         GROUP BY l.open_item_id
       ), doc AS (
         SELECT e.source_id AS open_item_id, e.id AS entry_id
         FROM billing_accounting_journal_entries e
         WHERE e.source_type IN ('invoice', 'supplier_invoice', 'opening_balance') AND e.reversal_of_entry_id IS NULL
           AND e.source_event IN ('issued', 'receivable', 'payable')
       ), tot AS (
         SELECT l.open_item_id, ABS(SUM(l.debit - l.credit)) AS total
         FROM billing_accounting_journal_lines l JOIN doc ON doc.entry_id = l.entry_id AND doc.open_item_id = l.open_item_id::text
         GROUP BY l.open_item_id
       )
       SELECT l.account_id, SUM((l.debit - l.credit) * (pay.paid / NULLIF(tot.total, 0))) AS amount
       FROM pay
       JOIN tot ON tot.open_item_id = pay.open_item_id
       JOIN doc ON doc.open_item_id = pay.open_item_id::text
       JOIN billing_accounting_journal_lines l ON l.entry_id = doc.entry_id AND l.open_item_id IS NULL
       GROUP BY l.account_id`,
      params,
    );
    // 2) Direct cash ↔ P&L postings and depreciation (entries without open items).
    const direct: Array<{ account_id: string; amount: string }> = await this.dataSource.query(
      `SELECT l.account_id, SUM(l.debit - l.credit) AS amount
       FROM billing_accounting_journal_lines l JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       JOIN billing_accounting_accounts a ON a.id = l.account_id
       WHERE e.posting_date >= $1 AND e.posting_date <= $2 ${tenantSql}
         AND e.source_type NOT IN ('invoice', 'supplier_invoice', 'opening_balance', 'credit_document')
         AND NOT EXISTS (SELECT 1 FROM billing_accounting_journal_lines x WHERE x.entry_id = e.id AND x.open_item_id IS NOT NULL)
         AND (a.type IN ('revenue', 'expense') OR a.external_codes ? 'cashBasis')
       GROUP BY l.account_id`,
      params,
    );
    const accounts = await this.dataSource.getRepository(AccountingAccountEntity).find();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const totals = new Map<string, number>();

    for (const row of [...allocated, ...direct]) {
      totals.set(
        row.account_id,
        fromCents(
          (totals.get(row.account_id) ? toCents(totals.get(row.account_id)!) : 0) + toCents(Number(row.amount)),
        ),
      );
    }

    const balances = [...totals.entries()]
      .map(([id, amount]) => ({ account: byId.get(id)!, debitMinusCredit: amount }))
      .filter((b) => b.account && b.account.externalCodes?.['cashBasis']);
    const nodes = this.buildPlNodes(
      layout.lines ?? [],
      balances.map((b) => ({ ...b, statementPosition: b.account.externalCodes?.['cashBasis'] ?? null })),
      (a) => a.statementPosition,
    );
    const result = fromCents(nodes.reduce((sum, n) => sum + toCents(n.amount), 0));

    return {
      layoutKey: layout.key,
      name: layout.name,
      from,
      to,
      sections: [{ key: 'lines', label: layout.name, nodes, total: result }],
      result,
      unassigned: [],
    };
  }

  /** Daily / monthly series of debits and credits and entry counts for statistics. */
  async journalSeries(from: string, to: string, tenant: TenantFilter, bucket: 'day' | 'month') {
    this.assertRange(from, to);

    const params: unknown[] = [from, to];
    const tenantSql = tenant !== null ? `AND e.tenant_id = $${params.push(tenant)}` : '';
    const trunc = bucket === 'day' ? 'day' : 'month';

    return (await this.dataSource.query(
      `SELECT to_char(date_trunc('${trunc}', e.posting_date), 'YYYY-MM-DD') AS bucket,
              COUNT(*)::int AS entries, SUM(e.total)::float AS volume,
              SUM(CASE WHEN e.kind = 'manual' THEN 1 ELSE 0 END)::int AS manual
       FROM billing_accounting_journal_entries e
       WHERE e.posting_date >= $1 AND e.posting_date <= $2 ${tenantSql}
       GROUP BY 1 ORDER BY 1`,
      params,
    )) as Array<{ bucket: string; entries: number; volume: number; manual: number }>;
  }

  /** Revenue vs. expenses per month (P&L account classes) for statistics. */
  async resultSeries(from: string, to: string, tenant: TenantFilter) {
    const params: unknown[] = [from, to];
    const tenantSql = tenant !== null ? `AND l.tenant_id = $${params.push(tenant)}` : '';

    return (await this.dataSource.query(
      `SELECT to_char(date_trunc('month', e.posting_date), 'YYYY-MM') AS month,
              SUM(CASE WHEN a.type = 'revenue' THEN l.credit - l.debit ELSE 0 END)::float AS revenue,
              SUM(CASE WHEN a.type = 'expense' THEN l.debit - l.credit ELSE 0 END)::float AS expenses
       FROM billing_accounting_journal_lines l
       JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       JOIN billing_accounting_accounts a ON a.id = l.account_id
       WHERE e.posting_date >= $1 AND e.posting_date <= $2 ${tenantSql}
       GROUP BY 1 ORDER BY 1`,
      params,
    )) as Array<{ month: string; revenue: number; expenses: number }>;
  }

  private async balancesByAccount(chartId: string, from: string, to: string, tenant: TenantFilter) {
    const params: unknown[] = [chartId, from, to];
    const tenantSql = tenant !== null ? `AND l.tenant_id = $${params.push(tenant)}` : '';
    const rows: Array<{ id: string; amount: string }> = await this.dataSource.query(
      `SELECT l.account_id AS id, SUM(l.debit - l.credit) AS amount
       FROM billing_accounting_journal_lines l
       JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       JOIN billing_accounting_accounts a ON a.id = l.account_id
       WHERE a.chart_id = $1 AND e.posting_date >= $2 AND e.posting_date <= $3 ${tenantSql}
       GROUP BY l.account_id`,
      params,
    );
    const accounts = await this.dataSource.getRepository(AccountingAccountEntity).find({ where: { chartId } });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    return rows
      .filter((r) => byId.has(r.id))
      .map((r) => ({
        account: byId.get(r.id)!,
        debitMinusCredit: Number(r.amount),
        statementPosition: byId.get(r.id)!.statementPosition ?? null,
      }));
  }

  private async previousYearBalances(
    startDate: string,
    tenant: TenantFilter,
    _kind: 'bs',
  ): Promise<Map<string, number> | null> {
    const prevYear = await this.fiscalYears.findYearForDate(addDays(startDate, -1));

    if (!prevYear) {
      return null;
    }

    const balances = await this.balancesByAccount(prevYear.chartId, prevYear.startDate, prevYear.endDate, tenant);
    const byPosition = new Map<string, number>();

    for (const b of balances) {
      if (!b.statementPosition) {
        continue;
      }

      const sign = [AccountingAccountType.ASSET].includes(b.account.type) ? 1 : -1;

      byPosition.set(
        b.statementPosition,
        fromCents(toCents(byPosition.get(b.statementPosition) ?? 0) + sign * toCents(b.debitMinusCredit)),
      );
    }

    // The year's result reaches retained earnings only with the next year's carry-forward entry, so the comparative
    // shows it in the result position like the current year does.
    const resultPosition = this.config.getConfig().profile.balanceSheet.resultPosition;

    if (resultPosition) {
      byPosition.set(
        resultPosition,
        fromCents(toCents(byPosition.get(resultPosition) ?? 0) + toCents(this.resultOf(balances))),
      );
    }

    return byPosition;
  }

  private resultOf(balances: Array<{ account: AccountingAccountEntity; debitMinusCredit: number }>): number {
    // Profit = credits − debits on P&L accounts.
    return fromCents(
      balances
        .filter((b) => PROFIT_AND_LOSS_ACCOUNT_TYPES.includes(b.account.type))
        .reduce((sum, b) => sum - toCents(b.debitMinusCredit), 0),
    );
  }

  private buildNodes(
    lines: StatementLayoutLine[],
    balances: Array<{ account: AccountingAccountEntity; debitMinusCredit: number; statementPosition: string | null }>,
    value: (b: { debitMinusCredit: number }) => number,
    previous: Map<string, number> | null,
  ): StatementNode[] {
    return lines.map((line) => {
      const children = this.buildNodes(line.children ?? [], balances, value, previous);
      const accounts = balances
        .filter((b) => b.statementPosition === line.code && BALANCE_SHEET_ACCOUNT_TYPES.includes(b.account.type))
        .map((b) => ({ number: b.account.number, name: b.account.name, amount: value(b) }))
        .filter((a) => toCents(a.amount) !== 0);
      const own = accounts.reduce((s, a) => s + toCents(a.amount), 0);
      const childSum = children.reduce((s, c) => s + toCents(c.amount), 0);

      return {
        code: line.code,
        label: line.label,
        amount: fromCents(own + childSum),
        ...(previous ? { previousAmount: this.previousOf(line, previous) } : {}),
        accounts,
        children,
      };
    });
  }

  private previousOf(line: StatementLayoutLine, previous: Map<string, number>): number {
    const own = toCents(previous.get(line.code) ?? 0);
    const children = (line.children ?? []).reduce((s, c) => s + toCents(this.previousOf(c, previous)), 0);

    return fromCents(own + children);
  }

  private buildPlNodes(
    lines: StatementLayoutLine[],
    balances: Array<{ account: AccountingAccountEntity; debitMinusCredit: number; statementPosition: string | null }>,
    position: (b: { account: AccountingAccountEntity; statementPosition: string | null }) => string | null,
  ): StatementNode[] {
    return lines.map((line) => {
      const children = this.buildPlNodes(line.children ?? [], balances, position);
      // Every amount is credit − debit (income positive, expenses negative) so each subtotal adds up to the result;
      // the layout's `sign` only tells the UI which lines are expense lines.
      const accounts = balances
        .filter((b) => position(b) === line.code)
        .map((b) => ({ number: b.account.number, name: b.account.name, amount: -b.debitMinusCredit }))
        .filter((a) => toCents(a.amount) !== 0);
      const own = accounts.reduce((s, a) => s + toCents(a.amount), 0);
      const childSum = children.reduce((s, c) => s + toCents(c.amount), 0);

      return { code: line.code, label: line.label, amount: fromCents(own + childSum), accounts, children };
    });
  }

  private addToPosition(nodes: StatementNode[], code: string, amount: number): boolean {
    for (const node of nodes) {
      if (node.code === code) {
        node.amount = fromCents(toCents(node.amount) + toCents(amount));
        node.accounts.push({ number: '—', name: 'Result of the period', amount });

        return true;
      }

      if (this.addToPosition(node.children, code, amount)) {
        node.amount = fromCents(toCents(node.amount) + toCents(amount));

        return true;
      }
    }

    return false;
  }

  private sumNodes(nodes: StatementNode[]): number {
    return fromCents(nodes.reduce((s, n) => s + toCents(n.amount), 0));
  }

  private unassigned(
    balances: Array<{ account: AccountingAccountEntity; debitMinusCredit: number }>,
    layout: StatementLayout,
    types: AccountingAccountType[],
  ) {
    const codes = new Set<string>();
    const collect = (lines: StatementLayoutLine[] = []): void => {
      for (const l of lines) {
        codes.add(l.code);
        collect(l.children);
      }
    };

    collect(layout.assets);
    collect(layout.equityAndLiabilities);
    collect(layout.lines);

    return balances
      .filter(
        (b) =>
          types.includes(b.account.type) && (!b.account.statementPosition || !codes.has(b.account.statementPosition)),
      )
      .filter((b) => toCents(b.debitMinusCredit) !== 0)
      .map((b) => ({ number: b.account.number, name: b.account.name, amount: b.debitMinusCredit }));
  }

  private assertRange(from: string, to: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      throw new BadRequestException('Invalid date range');
    }
  }
}
