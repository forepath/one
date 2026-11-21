import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  AccountingAccountRole as R,
  JournalEntryKind,
  JournalLinkRole,
  JournalLinkType,
  JournalSourceType,
  TaxCodeKind,
  VatBasis,
} from '../constants/accounting.constants';
import { AccountingVatReturnEntity } from '../entities/accounting-vat-return.entity';
import type { VatReturnDefinition } from '../profiles/accounting-profile.types';
import { addDays, addMonths, endOfMonth } from '../utils/accounting-date.util';
import { fromCents, toCents } from '../utils/accounting-money.util';

import { AccountingChartService } from './accounting-chart.service';
import { AccountingConfigService } from './accounting-config.service';
import { AccountingFiscalYearService } from './accounting-fiscal-year.service';
import { AccountingJournalService } from './accounting-journal.service';

interface BoxLine {
  kind: TaxCodeKind;
  tax_role: string | null;
  base_box: string | null;
  tax_box: string | null;
  reverse_tax_box: string | null;
  ec_sales_list: boolean;
  oss: boolean;
  eu_country: string | null;
  eu_vat_id: string | null;
  tax_rate: string | null;
  amount: string;
}

/**
 * VAT returns of the active country profile, computed from the journal for manual filing. Output VAT follows the
 * configured basis (invoice = Soll, payment = Ist: share of each invoice paid in the period); input VAT always
 * follows the invoice. Submitting freezes the figures and locks the periods (Festschreibung).
 */
@Injectable()
export class AccountingVatReturnService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
    private readonly fiscalYears: AccountingFiscalYearService,
    private readonly journal: AccountingJournalService,
    private readonly charts: AccountingChartService,
  ) {}

  definitions(): VatReturnDefinition[] {
    return this.config.getConfig().profile.vatReturns;
  }

  definition(key: string): VatReturnDefinition {
    const def = this.definitions().find((d) => d.key === key);

    if (!def) {
      throw new NotFoundException(`VAT return ${key} is not available for this country`);
    }

    return def;
  }

  /** Period boundaries for `period` (`month` / `quarter` / `year`) containing `date`. */
  periodBounds(period: 'month' | 'quarter' | 'year', date: string): { start: string; end: string } {
    const [y, m] = date.split('-').map(Number);

    if (period === 'month') {
      const start = `${y}-${String(m).padStart(2, '0')}-01`;

      return { start, end: endOfMonth(start) };
    }

    if (period === 'quarter') {
      const qStart = Math.floor((m - 1) / 3) * 3 + 1;
      const start = `${y}-${String(qStart).padStart(2, '0')}-01`;

      return { start, end: addDays(addMonths(start, 3), -1) };
    }

    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }

  async list(definitionKey?: string, limit = 50, offset = 0) {
    const qb = this.dataSource
      .getRepository(AccountingVatReturnEntity)
      .createQueryBuilder('r')
      .orderBy('r.periodStart', 'DESC')
      .take(limit)
      .skip(offset);

    if (definitionKey) {
      qb.where('r.definition_key = :key', { key: definitionKey });
    }

    const [items, total] = await qb.getManyAndCount();

    return { items, total };
  }

  async get(id: string): Promise<AccountingVatReturnEntity> {
    const row = await this.dataSource.getRepository(AccountingVatReturnEntity).findOne({ where: { id } });

    if (!row) {
      throw new NotFoundException('VAT return not found');
    }

    return row;
  }

  /** Computes (or recomputes a draft) return for the period. */
  async compute(input: {
    definitionKey: string;
    periodStart: string;
    periodEnd: string;
    manualValues?: Record<string, number>;
  }): Promise<AccountingVatReturnEntity> {
    const def = this.definition(input.definitionKey);

    if (!this.config.isFeatureAvailable(def.key)) {
      const missing = this.config.getFeatureAvailability().find((f) => f.key === def.key)?.missing ?? [];

      throw new BadRequestException(`VAT return ${def.key} needs: ${missing.join(', ') || 'accounting enabled'}`);
    }

    if (input.periodStart > input.periodEnd) {
      throw new BadRequestException('Invalid period');
    }

    const repo = this.dataSource.getRepository(AccountingVatReturnEntity);
    const existing = await repo.findOne({
      where: { definitionKey: def.key, periodStart: input.periodStart, periodEnd: input.periodEnd },
    });

    if (existing && existing.status !== 'draft') {
      throw new ConflictException('This VAT return was already submitted; its figures are frozen');
    }

    const manualValues = this.sanitizeManual(def, { ...(existing?.manualValues ?? {}), ...(input.manualValues ?? {}) });
    const { figures, details } = await this.calculate(def, input.periodStart, input.periodEnd, manualValues);
    const resultAmount = def.resultBox ? (figures[def.resultBox] ?? 0) : null;
    const row = repo.create({
      ...(existing ?? {}),
      definitionKey: def.key,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: 'draft',
      vatBasis: this.config.getConfig().vatBasis,
      figures,
      details,
      manualValues,
      resultAmount,
      computedAt: new Date(),
    });

    return await repo.save(row);
  }

  /** Marks the return as filed (reference from ELSTER/portal) and locks the periods through its end. */
  async submit(id: string, input: { filingReference?: string | null; note?: string | null }, userId: string | null) {
    const row = await this.get(id);

    if (row.status !== 'draft') {
      throw new ConflictException('VAT return already submitted');
    }

    const recomputed = await this.compute({
      definitionKey: row.definitionKey,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
    });

    await this.fiscalYears.lockPeriodsThrough(row.periodEnd, userId);
    await this.dataSource.getRepository(AccountingVatReturnEntity).update(id, {
      status: 'submitted',
      submittedAt: new Date(),
      submittedByUserId: userId,
      filingReference: input.filingReference?.slice(0, 128) ?? null,
      note: input.note ?? null,
      figures: recomputed.figures,
      details: recomputed.details,
    });

    return await this.get(id);
  }

  /** Books the payment (or refund) of the return: VAT prepayment account against the bank. */
  async recordPayment(id: string, input: { date: string; amount?: number }, userId: string | null) {
    const row = await this.get(id);

    if (row.status !== 'submitted') {
      throw new BadRequestException('Only submitted returns can be paid');
    }

    const amount = input.amount ?? Number(row.resultAmount ?? 0);

    if (toCents(amount) === 0) {
      throw new BadRequestException('Nothing to pay');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const target = await this.fiscalYears.resolvePostingTarget(input.date, manager);
      const prepayments = await this.charts.requireAccountByRole(target.fiscalYear.chartId, R.VAT_PREPAYMENTS, manager);
      const bank = await this.charts.requireAccountByRole(target.fiscalYear.chartId, R.BANK, manager);
      const cents = toCents(amount);

      return await this.journal.post(
        {
          documentDate: input.date,
          documentNumber: `${row.definitionKey} ${row.periodStart.slice(0, 7)}`,
          description: `VAT ${cents > 0 ? 'payment' : 'refund'} ${row.definitionKey} ${row.periodStart}–${row.periodEnd}`,
          kind: JournalEntryKind.VAT_SETTLEMENT,
          sourceType: JournalSourceType.VAT_RETURN,
          sourceId: row.id,
          sourceEvent: 'payment',
          idempotencyKey: `vat_return:${row.id}:payment`,
          createdByUserId: userId,
          lines: [
            { accountId: prepayments.id, ...(cents > 0 ? { debit: fromCents(cents) } : { credit: fromCents(-cents) }) },
            { accountId: bank.id, ...(cents > 0 ? { credit: fromCents(cents) } : { debit: fromCents(-cents) }) },
          ],
          links: [{ linkType: JournalLinkType.VAT_RETURN, targetId: row.id, role: JournalLinkRole.SOURCE }],
        },
        manager,
      );
    });

    await this.dataSource
      .getRepository(AccountingVatReturnEntity)
      .update(id, { status: 'paid', paymentEntryId: result.entry.id });

    return await this.get(id);
  }

  async calculate(
    def: VatReturnDefinition,
    from: string,
    to: string,
    manualValues: Record<string, number>,
  ): Promise<{ figures: Record<string, number>; details: Array<Record<string, unknown>> }> {
    const lines = await this.boxLines(from, to);
    const figures: Record<string, number> = {};
    const add = (box: string | null, cents: number): void => {
      if (box) {
        figures[box] = fromCents(toCents(figures[box] ?? 0) + cents);
      }
    };

    for (const line of lines) {
      if (line.oss && def.kind !== 'oss') {
        continue;
      }

      // Output / exempt: credit − debit; input: debit − credit (the query returns debit − credit).
      const raw = toCents(Number(line.amount));
      const outputSign = line.kind === TaxCodeKind.OUTPUT || line.kind === TaxCodeKind.EXEMPT ? -1 : 1;

      if (line.tax_role === 'base') {
        add(line.base_box, line.kind === TaxCodeKind.REVERSE_CHARGE ? raw : outputSign * raw);
      } else if (line.tax_role === 'tax') {
        // Reverse charge 'tax' = the payable side (credit), reported positive.
        add(line.tax_box, line.kind === TaxCodeKind.REVERSE_CHARGE ? -raw : outputSign * raw);
      } else if (line.tax_role === 'reverse_tax') {
        add(line.reverse_tax_box, raw);
      }
    }

    const details: Array<Record<string, unknown>> = [];

    if (def.kind === 'ec_sales_list') {
      const byId = new Map<string, { vatId: string; country: string; amount: number }>();

      for (const line of lines.filter((l) => l.ec_sales_list && l.tax_role === 'base')) {
        const key = `${line.eu_vat_id ?? '?'}`;
        const entry = byId.get(key) ?? {
          vatId: line.eu_vat_id ?? '',
          country: line.eu_country ?? (line.eu_vat_id ?? '').slice(0, 2),
          amount: 0,
        };

        entry.amount = fromCents(toCents(entry.amount) - toCents(Number(line.amount)));
        byId.set(key, entry);
      }

      details.push(
        ...[...byId.values()]
          .filter((d) => toCents(d.amount) !== 0)
          .map((d) => ({ ...d, amount: Math.round(d.amount), type: 'S' })),
      );
    }

    if (def.kind === 'oss') {
      const byCountry = new Map<string, { country: string; rate: number; base: number; tax: number }>();

      for (const line of lines.filter((l) => l.oss)) {
        const rate = Number(line.tax_rate ?? 0);
        const key = `${line.eu_country}:${rate}`;
        const entry = byCountry.get(key) ?? { country: line.eu_country ?? '??', rate, base: 0, tax: 0 };
        const value = -toCents(Number(line.amount));

        if (line.tax_role === 'base') {
          entry.base = fromCents(toCents(entry.base) + value);
        } else if (line.tax_role === 'tax') {
          entry.tax = fromCents(toCents(entry.tax) + value);
        }

        byCountry.set(key, entry);
      }

      details.push(...[...byCountry.values()].sort((a, b) => a.country.localeCompare(b.country)));
      figures['base'] = fromCents(details.reduce((s, d) => s + toCents(Number(d['base'])), 0));
      figures['tax'] = fromCents(details.reduce((s, d) => s + toCents(Number(d['tax'])), 0));
    }

    for (const box of def.boxes) {
      if (box.kind === 'manual') {
        figures[box.box] = manualValues[box.box] ?? 0;
      } else if (box.kind !== 'computed') {
        const value = figures[box.box] ?? 0;

        figures[box.box] = box.roundDown ? Math.trunc(value) : value;
      }
    }

    this.resolveComputedBoxes(def, figures);

    return { figures, details };
  }

  /** Journal lines with tax codes in [from, to], adjusted to the output basis. */
  private async boxLines(from: string, to: string): Promise<BoxLine[]> {
    const basis = this.config.getConfig().vatBasis;
    const base = `
      SELECT tc.kind, l.tax_role, tc.base_box, tc.tax_box, tc.reverse_tax_box, tc.ec_sales_list, tc.oss,
             l.eu_country, l.eu_vat_id, l.tax_rate::text AS tax_rate`;

    if (basis === VatBasis.INVOICE) {
      return await this.dataSource.query(
        `${base}, SUM(l.debit - l.credit)::text AS amount
         FROM billing_accounting_journal_lines l
         JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
         JOIN billing_accounting_tax_codes tc ON tc.id = l.tax_code_id
         WHERE e.posting_date >= $1 AND e.posting_date <= $2 AND l.tax_role IS NOT NULL
         GROUP BY tc.kind, l.tax_role, tc.base_box, tc.tax_box, tc.reverse_tax_box, tc.ec_sales_list, tc.oss, l.eu_country, l.eu_vat_id, l.tax_rate`,
        [from, to],
      );
    }

    // Payment basis (Ist, § 20 UStG): input / reverse-charge lines by invoice date; output VAT of customer documents
    // by the cash received in the period, at the VAT share of the document that opened the item (its issue entry —
    // later credit notes or voids must not change the share: a refund of a fully credited invoice still gives back
    // its VAT). Write-offs, discounts and other customer settlement corrections are not booked on their own: cash
    // that never came in was never declared. Other entries (manual, assets, …) count as booked.
    const inputLines: BoxLine[] = await this.dataSource.query(
      `${base}, SUM(l.debit - l.credit)::text AS amount
       FROM billing_accounting_journal_lines l
       JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
       JOIN billing_accounting_tax_codes tc ON tc.id = l.tax_code_id
       WHERE e.posting_date >= $1 AND e.posting_date <= $2 AND l.tax_role IS NOT NULL
         AND (tc.kind IN ('input', 'reverse_charge') OR e.source_type NOT IN ('invoice', 'credit_document', 'settlement'))
       GROUP BY tc.kind, l.tax_role, tc.base_box, tc.tax_box, tc.reverse_tax_box, tc.ec_sales_list, tc.oss, l.eu_country, l.eu_vat_id, l.tax_rate`,
      [from, to],
    );
    const outputLines: BoxLine[] = await this.dataSource.query(
      `WITH paid AS (
         SELECT l.open_item_id, SUM(l.credit - l.debit) AS paid
         FROM billing_accounting_journal_lines l JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
         WHERE e.source_type = 'settlement' AND l.counterparty_type = 'customer' AND l.open_item_id IS NOT NULL
           AND e.posting_date >= $1 AND e.posting_date <= $2
           AND e.source_event IN ('payment', 'payment_reversal', 'refund', 'credit_transfer_in')
         GROUP BY l.open_item_id
       ), origin AS (
         SELECT DISTINCT ON (l.open_item_id) l.open_item_id, e.id AS entry_id
         FROM billing_accounting_journal_lines l JOIN billing_accounting_journal_entries e ON e.id = l.entry_id
         WHERE e.source_type IN ('invoice', 'credit_document') AND l.counterparty_type = 'customer'
           AND l.open_item_id IN (SELECT open_item_id FROM paid)
         ORDER BY l.open_item_id, e.posting_date, e.created_at, e.id
       ), totals AS (
         SELECT o.open_item_id, o.entry_id, SUM(l.debit - l.credit) AS gross
         FROM origin o
         JOIN billing_accounting_journal_lines l ON l.entry_id = o.entry_id AND l.open_item_id = o.open_item_id
         GROUP BY o.open_item_id, o.entry_id
       )
       ${base}, SUM((l.debit - l.credit) * (paid.paid / NULLIF(totals.gross, 0)))::text AS amount
       FROM paid
       JOIN totals ON totals.open_item_id = paid.open_item_id
       JOIN billing_accounting_journal_lines l ON l.entry_id = totals.entry_id
       JOIN billing_accounting_tax_codes tc ON tc.id = l.tax_code_id
       WHERE tc.kind IN ('output', 'exempt') AND l.tax_role IS NOT NULL
       GROUP BY tc.kind, l.tax_role, tc.base_box, tc.tax_box, tc.reverse_tax_box, tc.ec_sales_list, tc.oss, l.eu_country, l.eu_vat_id, l.tax_rate`,
      [from, to],
    );

    return [...inputLines, ...outputLines];
  }

  /**
   * Fills the computed boxes of `def` into `figures`. Computed boxes may reference each other in any order:
   * dependencies are resolved first (a box id is never read as a numeric literal because its formula is listed
   * later); circular definitions are rejected.
   */
  resolveComputedBoxes(def: Pick<VatReturnDefinition, 'key' | 'boxes'>, figures: Record<string, number>): void {
    const computed = new Map(def.boxes.filter((b) => b.kind === 'computed').map((b) => [b.box, b.formula ?? '']));
    const resolved = new Set<string>();
    const resolving = new Set<string>();
    const resolve = (box: string): void => {
      if (resolved.has(box)) return;

      if (resolving.has(box)) {
        throw new BadRequestException(`Circular VAT box formula at ${box} (${def.key})`);
      }

      resolving.add(box);

      const formula = computed.get(box) ?? '';

      for (const token of formula.split(/\s+/)) {
        if (computed.has(token)) resolve(token);
      }

      figures[box] = this.evaluate(formula, figures);
      resolving.delete(box);
      resolved.add(box);
    };

    for (const box of computed.keys()) {
      resolve(box);
    }
  }

  /** Evaluates `81T + 86T - 66` style formulas over box values (only + / − of box ids and numeric literals). */
  evaluate(formula: string, figures: Record<string, number>): number {
    const tokens = formula.split(/\s+/).filter(Boolean);
    let total = 0;
    let sign = 1;

    for (const token of tokens) {
      if (token === '+') {
        sign = 1;
      } else if (token === '-') {
        sign = -1;
      } else {
        // Box ids are often numeric (DE "66", FR "08"): a known box always wins over a numeric literal.
        const value = token in figures ? figures[token] : /^-?\d+(\.\d+)?$/.test(token) ? Number(token) : 0;

        total += sign * toCents(value);
        sign = 1;
      }
    }

    return fromCents(total);
  }

  private sanitizeManual(def: VatReturnDefinition, values: Record<string, number>): Record<string, number> {
    const allowed = new Set(def.boxes.filter((b) => b.kind === 'manual').map((b) => b.box));
    const out: Record<string, number> = {};

    for (const [box, value] of Object.entries(values)) {
      if (allowed.has(box) && Number.isFinite(Number(value))) {
        out[box] = Math.round(Number(value) * 100) / 100;
      }
    }

    return out;
  }
}
