import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import {
  AccountingAccountRole as R,
  CounterpartyType,
  JournalEntryKind,
  JournalLinkRole,
  JournalLinkType,
  JournalSourceType,
} from '../constants/accounting.constants';
import { addDays, resolveAccountingTimezone } from '../utils/accounting-date.util';
import { fromCents, toCents } from '../utils/accounting-money.util';

import { AccountingChartService } from './accounting-chart.service';
import { AccountingConfigService } from './accounting-config.service';
import { AccountingFiscalYearService } from './accounting-fiscal-year.service';
import { AccountingFxService } from './accounting-fx.service';
import { AccountingJournalService, type JournalLineInput } from './accounting-journal.service';
import { AccountingPostingService } from './accounting-posting.service';

export interface CatchUpResult {
  invoicesIssued: number;
  invoicesVoided: number;
  creditDocuments: number;
  settlements: number;
  supplierInvoicesIssued: number;
  supplierInvoicesVoided: number;
  openingItems: number;
  retriedIssues: number;
}

const BATCH = 200;

/**
 * Backfills bookings: documents dated on/after the bookkeeping start without an automatic entry are posted (this
 * also retries failed postings), and at the first run open customer/supplier items from before the start are taken
 * over as opening balances (per open item, against the carry-forward accounts).
 */
@Injectable()
export class AccountingCatchUpService {
  private readonly logger = new Logger(AccountingCatchUpService.name);
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
    private readonly posting: AccountingPostingService,
    private readonly journal: AccountingJournalService,
    private readonly fiscalYears: AccountingFiscalYearService,
    private readonly charts: AccountingChartService,
    private readonly fx: AccountingFxService,
  ) {}

  async run(): Promise<CatchUpResult | null> {
    if (!this.config.isEnabled() || this.running) {
      return null;
    }

    this.running = true;

    try {
      const start = this.config.getConfig().startDate;
      const tz = resolveAccountingTimezone();
      // Opening items must not block the document backfills (e.g. an unmapped opening-balance role).
      const openingItems = await this.takeOverOpeningItems().catch((error: Error) => {
        this.logger.warn(`Opening item takeover failed: ${error.message}`);

        return 0;
      });
      const result: CatchUpResult = {
        openingItems,
        invoicesIssued: await this.each(
          `SELECT i.id FROM billing_invoices i
           WHERE i.status NOT IN ('draft') AND i.issued_at IS NOT NULL AND ((i.issued_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date >= $1::date AND i.total_gross <> 0
             AND NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key = 'invoice:' || i.id || ':issued')
           ORDER BY i.issued_at LIMIT ${BATCH}`,
          [start, tz],
          (m, id) => this.posting.onInvoiceIssued(m, id),
        ),
        creditDocuments: await this.each(
          `SELECT c.id FROM billing_invoice_credit_documents c
           WHERE ((c.withdrawn_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date >= $1::date AND c.credit_gross <> 0
             AND NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key = 'credit_document:' || c.id || ':created')
           ORDER BY c.withdrawn_at LIMIT ${BATCH}`,
          [start, tz],
          (m, id) => this.posting.onCreditDocumentCreated(m, id),
        ),
        invoicesVoided: await this.each(
          `SELECT i.id FROM billing_invoices i
           WHERE i.status = 'void' AND i.voided_at IS NOT NULL AND ((i.voided_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date >= $1::date AND i.total_gross <> 0
             AND i.invoice_number IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key = 'invoice:' || i.id || ':voided')
           ORDER BY i.voided_at LIMIT ${BATCH}`,
          [start, tz],
          (m, id) => this.posting.onInvoiceVoided(m, id),
        ),
        supplierInvoicesIssued: await this.each(
          `SELECT s.id FROM billing_supplier_invoices s
           WHERE s.status NOT IN ('draft') AND COALESCE(s.issue_date, ((s.issued_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date) >= $1::date AND s.total_gross <> 0
             AND NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key = 'supplier_invoice:' || s.id || ':issued')
           ORDER BY s.issued_at LIMIT ${BATCH}`,
          [start, tz],
          (m, id) => this.posting.onSupplierInvoiceIssued(m, id),
        ),
        supplierInvoicesVoided: await this.each(
          `SELECT s.id FROM billing_supplier_invoices s
           WHERE s.status = 'void' AND s.voided_at IS NOT NULL AND ((s.voided_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date >= $1::date AND s.total_gross <> 0
             AND NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key = 'supplier_invoice:' || s.id || ':voided')
           ORDER BY s.voided_at LIMIT ${BATCH}`,
          [start, tz],
          (m, id) => this.posting.onSupplierInvoiceVoided(m, id),
        ),
        settlements: await this.each(
          `SELECT s.id FROM billing_document_settlements s
           WHERE ((s.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date >= $1::date AND s.amount <> 0
             AND s.type NOT IN ('credit', 'credit_transfer_out')
             AND NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key = 'settlement:' || s.id || ':' || s.type)
           ORDER BY s.occurred_at, s.created_at LIMIT ${BATCH}`,
          [start, tz],
          (m, id) => this.posting.onSettlementApplied(m, id),
        ),
        retriedIssues: await this.retryOpenIssues(),
      };

      return result;
    } finally {
      this.running = false;
    }
  }

  /** Document-currency amount in the functional currency at the document date's rate (sign-symmetric rounding). */
  private async functional(manager: EntityManager, amount: number, currency: string, date: string): Promise<number> {
    const { rate } = await this.fx.convert(1, currency, date, manager);

    return rate === 1 ? amount : Math.sign(amount) * (Math.round((Math.abs(amount) / rate) * 100) / 100);
  }

  /**
   * Opening items: documents issued before the start date that were open AT the start date open the receivables /
   * payables of the first fiscal year against the carry-forward accounts. The opening amount is reconstructed from
   * the settlement history (gross minus what was settled before the start, in the booking time zone) — not today's
   * balance: settlements and voids after the start are booked by the catch-up and clear the item themselves. Amounts
   * are converted at the document's own rate, as its later settlements are. Runs once per document.
   */
  async takeOverOpeningItems(): Promise<number> {
    const start = this.config.getConfig().startDate;
    const tz = resolveAccountingTimezone();
    let count = 0;
    // Effect of a settlement on the open balance (positive = reduces it).
    const settledBefore = (documentType: string, documentId: string) => `COALESCE((
             SELECT SUM(CASE WHEN st.type IN ('payment', 'credit', 'write_off', 'discount', 'credit_transfer_in') THEN st.amount
                             WHEN st.type IN ('payment_reversal', 'refund', 'credit_transfer_out') THEN -st.amount
                             ELSE 0 END)
             FROM billing_document_settlements st
             WHERE st.document_type = '${documentType}' AND st.document_id = ${documentId}
               AND ((st.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date < $1::date), 0)`;

    await this.dataSource.transaction(async (manager) => {
      const year = await this.fiscalYears.ensureYearForDate(start, manager);

      if (year.startDate !== start && year.startDate > start) {
        return;
      }

      const customerItems: Array<{
        id: string;
        user_id: string;
        balance: string;
        number: string | null;
        tenant_id: string | null;
        currency: string;
        doc_date: string;
      }> = (
        await manager.query(
          `SELECT i.id, i.user_id, i.invoice_number AS number, u.tenant_id, i.currency,
                  ((i.issued_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date::text AS doc_date,
                  (i.total_gross - ${settledBefore('invoice', 'i.id')})::text AS balance
             FROM billing_invoices i JOIN users u ON u.id = i.user_id
             WHERE i.status <> 'draft' AND i.issued_at IS NOT NULL
               AND ((i.issued_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date < $1::date
               -- Voided before the start: gone. Voided later: open at the start, the void is booked at its date.
               AND (i.status <> 'void' OR ((i.voided_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date >= $1::date)
               AND NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key = 'opening_balance:' || i.id || ':receivable')`,
          [start, tz],
        )
      ).filter((r: { balance: string }) => toCents(Number(r.balance)) !== 0);
      const supplierItems: Array<{
        id: string;
        supplier_id: string;
        balance: string;
        number: string | null;
        tenant_id: string;
        currency: string;
        doc_date: string;
      }> = (
        await manager.query(
          `SELECT s.id, s.supplier_id, s.invoice_number AS number, p.tenant_id, s.currency,
                  COALESCE(s.issue_date, ((s.issued_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date)::text AS doc_date,
                  (s.total_gross - ${settledBefore('supplier_invoice', 's.id')})::text AS balance
             FROM billing_supplier_invoices s JOIN billing_supplier_profiles p ON p.id = s.supplier_id
             WHERE s.status <> 'draft' AND s.issued_at IS NOT NULL
               AND COALESCE(s.issue_date, ((s.issued_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date) < $1::date
               AND (s.status <> 'void' OR ((s.voided_at AT TIME ZONE 'UTC') AT TIME ZONE $2)::date >= $1::date)
               AND NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key = 'opening_balance:' || s.id || ':payable')`,
          [start, tz],
        )
      ).filter((r: { balance: string }) => toCents(Number(r.balance)) !== 0);

      if (customerItems.length === 0 && supplierItems.length === 0) {
        return;
      }

      const chartId = year.chartId;
      const receivables = (await this.charts.requireAccountByRole(chartId, R.RECEIVABLES, manager)).id;
      const payables = (await this.charts.requireAccountByRole(chartId, R.PAYABLES, manager)).id;
      const openingAr = (await this.charts.requireAccountByRole(chartId, R.OPENING_BALANCE_RECEIVABLES, manager)).id;
      const openingAp = (await this.charts.requireAccountByRole(chartId, R.OPENING_BALANCE_PAYABLES, manager)).id;

      for (const item of customerItems) {
        const cents = toCents(await this.functional(manager, Number(item.balance), item.currency, item.doc_date));
        const lines: JournalLineInput[] = [
          {
            accountId: receivables,
            ...(cents > 0 ? { debit: fromCents(cents) } : { credit: fromCents(-cents) }),
            counterpartyType: CounterpartyType.CUSTOMER,
            counterpartyId: item.user_id,
            openItemId: item.id,
            tenantId: item.tenant_id,
          },
          {
            accountId: openingAr,
            ...(cents > 0 ? { credit: fromCents(cents) } : { debit: fromCents(-cents) }),
            tenantId: item.tenant_id,
          },
        ];

        await this.journal.post(
          {
            documentDate: year.startDate,
            documentNumber: item.number,
            description: `Opening item ${item.number ?? item.id}`,
            kind: JournalEntryKind.OPENING,
            sourceType: JournalSourceType.OPENING_BALANCE,
            sourceId: item.id,
            sourceEvent: 'receivable',
            idempotencyKey: `opening_balance:${item.id}:receivable`,
            tenantId: item.tenant_id,
            fiscalYearId: year.id,
            lines,
            links: [{ linkType: JournalLinkType.INVOICE, targetId: item.id, role: JournalLinkRole.SOURCE }],
          },
          manager,
        );
        count += 1;
      }

      for (const item of supplierItems) {
        const cents = toCents(await this.functional(manager, Number(item.balance), item.currency, item.doc_date));
        const lines: JournalLineInput[] = [
          {
            accountId: payables,
            ...(cents > 0 ? { credit: fromCents(cents) } : { debit: fromCents(-cents) }),
            counterpartyType: CounterpartyType.SUPPLIER,
            counterpartyId: item.supplier_id,
            openItemId: item.id,
            tenantId: item.tenant_id,
          },
          {
            accountId: openingAp,
            ...(cents > 0 ? { debit: fromCents(cents) } : { credit: fromCents(-cents) }),
            tenantId: item.tenant_id,
          },
        ];

        await this.journal.post(
          {
            documentDate: year.startDate,
            documentNumber: item.number,
            description: `Opening item supplier invoice ${item.number ?? item.id}`,
            kind: JournalEntryKind.OPENING,
            sourceType: JournalSourceType.OPENING_BALANCE,
            sourceId: item.id,
            sourceEvent: 'payable',
            idempotencyKey: `opening_balance:${item.id}:payable`,
            tenantId: item.tenant_id,
            fiscalYearId: year.id,
            lines,
            links: [{ linkType: JournalLinkType.SUPPLIER_INVOICE, targetId: item.id, role: JournalLinkRole.SOURCE }],
          },
          manager,
        );
        count += 1;
      }
    });

    if (count > 0) {
      this.logger.log(`Took over ${count} open item(s) as opening balances at ${start}`);
    }

    return count;
  }

  private async each(
    sql: string,
    params: unknown[],
    fn: (manager: EntityManager, id: string) => Promise<void>,
  ): Promise<number> {
    const rows: Array<{ id: string }> = await this.dataSource.query(sql, params);

    for (const row of rows) {
      await this.dataSource.transaction(async (manager) => await fn(manager, row.id));
    }

    return rows.length;
  }

  /**
   * Re-runs the posting of every open posting issue (e.g. after a missing account role was mapped). The posting
   * service resolves the issue when the entry is booked, already exists or turns out to book nothing.
   */
  async retryOpenIssues(): Promise<number> {
    const issues: Array<{ source_type: string; source_id: string; source_event: string }> = await this.dataSource.query(
      `SELECT source_type, source_id, source_event FROM billing_accounting_posting_issues
       WHERE resolved_at IS NULL ORDER BY updated_at LIMIT ${BATCH}`,
    );
    let retried = 0;

    for (const issue of issues) {
      const handler = this.issueHandler(issue.source_type, issue.source_event);

      if (!handler) {
        continue;
      }

      await this.dataSource.transaction(async (manager) => await handler(manager, issue.source_id));
      retried += 1;
    }

    return retried;
  }

  private issueHandler(
    sourceType: string,
    event: string,
  ): ((manager: EntityManager, id: string) => Promise<void>) | null {
    switch (`${sourceType}:${event}`) {
      case 'invoice:issued':
        return (m, id) => this.posting.onInvoiceIssued(m, id);
      case 'invoice:voided':
        return (m, id) => this.posting.onInvoiceVoided(m, id);
      case 'credit_document:created':
        return (m, id) => this.posting.onCreditDocumentCreated(m, id);
      case 'supplier_invoice:issued':
        return (m, id) => this.posting.onSupplierInvoiceIssued(m, id);
      case 'supplier_invoice:voided':
        return (m, id) => this.posting.onSupplierInvoiceVoided(m, id);
      case 'inventory_movement:booked':
        return (m, id) => this.posting.onInventoryMovementBooked(m, id);
      default:
        // Settlement events carry the settlement type as event name.
        return sourceType === 'settlement' ? (m, id) => this.posting.onSettlementApplied(m, id) : null;
    }
  }

  /** Unused-date guard for callers wanting the day before the start. */
  dayBeforeStart(): string {
    return addDays(this.config.getConfig().startDate, -1);
  }
}
