import {
  limitActionCenterSql,
  type ActionCenterSqlRunner,
  taskGroup,
  toCount,
  toDateString,
  toDecimalString,
  toIsoString,
  type ActionCenterCollectContext,
  type ActionCenterGroupDraft,
  type ActionCenterSource,
  type ActionCenterTaskDefinition,
} from '@forepath/shared/backend';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { DECABILL_ACTION_TYPES as T, PROFILE_DISPLAY_NAME_SQL } from './decabill-action-center.types';

/** Accepted / archived offers expiring within this many days are flagged. */
const OFFER_EXPIRY_WARNING_DAYS = 7;

interface DocumentRow {
  id: string;
  number: string | null;
  customer: string | null;
  total_gross: string | null;
  balance_due?: string | null;
  currency: string | null;
  at: Date | string | null;
  due_date?: string | Date | null;
  total: string;
}

/**
 * Customer documents: invoices (unsent, credit notes unsent, drafts, overdue, auto-payment exhausted) and offers
 * (drafts, unsent, expiring, failed fulfillment). Scoped to the tenant through the document owner (`users`).
 */
@Injectable()
export class BillingDocumentsActionSource implements ActionCenterSource {
  readonly key = 'decabill.documents';
  readonly types = [
    T.invoicesUnsent,
    T.creditNotesUnsent,
    T.invoicesDraft,
    T.invoicesOverdue,
    T.invoicesAutoPaymentExhausted,
    T.offersDraft,
    T.offersUnsent,
    T.offersExpiring,
    T.offersFulfillmentFailed,
  ];

  /** At most a few concurrent queries per source (see `limitActionCenterSql`). */
  private readonly sql: ActionCenterSqlRunner;

  constructor(dataSource: DataSource) {
    this.sql = limitActionCenterSql(dataSource);
  }

  async collect(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const invoice = (definition: ActionCenterTaskDefinition, where: string, orderBy: string, at: string) =>
      this.documents(definition, context, {
        from: `billing_invoices d`,
        number: 'd.invoice_number',
        at,
        where,
        orderBy,
      });
    const offer = (definition: ActionCenterTaskDefinition, where: string, orderBy: string, at: string) =>
      this.documents(definition, context, { from: `billing_offers d`, number: 'd.offer_number', at, where, orderBy });
    const groups = await Promise.all([
      invoice(
        { type: T.invoicesUnsent, category: 'receivables', severity: 'warning' },
        `d.invoice_number IS NOT NULL AND d.status NOT IN ('draft', 'void') AND d.sent_at IS NULL`,
        'd.issued_at DESC NULLS LAST',
        'd.issued_at',
      ),
      invoice(
        { type: T.creditNotesUnsent, category: 'receivables', severity: 'warning' },
        `d.invoice_number IS NOT NULL AND d.status = 'void' AND d.void_document_sent_at IS NULL`,
        'd.voided_at DESC NULLS LAST',
        'd.voided_at',
      ),
      invoice(
        { type: T.invoicesDraft, category: 'receivables', severity: 'info' },
        `d.status = 'draft'`,
        'd.created_at DESC',
        'd.created_at',
      ),
      invoice(
        { type: T.invoicesOverdue, category: 'receivables', severity: 'danger' },
        `d.status = 'overdue'`,
        'd.due_date ASC NULLS LAST',
        'd.due_date',
      ),
      invoice(
        { type: T.invoicesAutoPaymentExhausted, category: 'receivables', severity: 'danger' },
        `d.auto_payment_status = 'exhausted' AND d.status IN ('issued', 'partially_paid', 'overdue')`,
        'd.created_at DESC',
        'd.created_at',
      ),
      offer(
        { type: T.offersDraft, category: 'offers', severity: 'info' },
        `d.status = 'draft'`,
        'd.updated_at DESC',
        'd.updated_at',
      ),
      offer(
        { type: T.offersUnsent, category: 'offers', severity: 'warning' },
        `d.status = 'archived' AND d.sent_at IS NULL AND (d.expires_at IS NULL OR d.expires_at > $3)`,
        'd.archived_at DESC NULLS LAST',
        'd.archived_at',
      ),
      offer(
        { type: T.offersExpiring, category: 'offers', severity: 'info' },
        `d.status = 'archived' AND d.expires_at > $3 AND d.expires_at <= $4`,
        'd.expires_at ASC',
        'd.expires_at',
      ),
      this.failedFulfillments(context),
    ]);

    return groups.flat();
  }

  private async documents(
    definition: ActionCenterTaskDefinition,
    context: ActionCenterCollectContext,
    query: { from: string; number: string; at: string; where: string; orderBy: string },
  ): Promise<ActionCenterGroupDraft[]> {
    const isInvoice = query.from.startsWith('billing_invoices');
    const expiringUntil = new Date(context.now.getTime() + OFFER_EXPIRY_WARNING_DAYS * 86_400_000);
    // Postgres rejects unused bind values: pass `now` ($3) / the expiry horizon ($4) only when referenced.
    const values: unknown[] = [context.scopeKey, context.itemLimit, context.now, expiringUntil].slice(
      0,
      query.where.includes('$4') ? 4 : query.where.includes('$3') ? 3 : 2,
    );
    const rows: DocumentRow[] = await this.sql.query(
      `SELECT d.id, ${query.number} AS number, ${PROFILE_DISPLAY_NAME_SQL('cp')} AS customer,
              d.total_gross, ${isInvoice ? 'd.balance_due, d.due_date,' : 'd.expires_at AS due_date,'} d.currency,
              ${query.at} AS at, COUNT(*) OVER () AS total
         FROM ${query.from}
         JOIN users u ON u.id = d.user_id AND u.tenant_id = $1
         LEFT JOIN billing_customer_profiles cp ON cp.user_id = d.user_id
        WHERE ${query.where}
        ORDER BY ${query.orderBy}
        LIMIT $2`,
      values,
    );

    return taskGroup(
      definition,
      toCount(rows[0]?.total),
      rows.map((row) => ({
        id: row.id,
        occurredAt: toIsoString(row.at),
        params: {
          number: row.number,
          customer: row.customer,
          totalGross: toDecimalString(row.total_gross),
          balanceDue: toDecimalString(row.balance_due),
          currency: row.currency,
          dueDate: toDateString(row.due_date ?? null),
        },
      })),
    );
  }

  private async failedFulfillments(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const rows: Array<{
      id: string;
      offer_id: string;
      number: string | null;
      description: string | null;
      customer: string | null;
      at: Date | null;
      total: string;
    }> = await this.sql.query(
      `SELECT l.id, o.id AS offer_id, o.offer_number AS number, l.description,
              ${PROFILE_DISPLAY_NAME_SQL('cp')} AS customer, COALESCE(l.scheduled_at, o.accepted_at) AS at,
              COUNT(*) OVER () AS total
         FROM billing_offer_line_items l
         JOIN billing_offers o ON o.id = l.offer_id
         JOIN users u ON u.id = o.user_id AND u.tenant_id = $1
         LEFT JOIN billing_customer_profiles cp ON cp.user_id = o.user_id
        WHERE l.fulfillment_status = 'failed'
        ORDER BY o.accepted_at DESC NULLS LAST, l.position ASC
        LIMIT $2`,
      [context.scopeKey, context.itemLimit],
    );

    return taskGroup(
      { type: T.offersFulfillmentFailed, category: 'offers', severity: 'danger' },
      toCount(rows[0]?.total),
      rows.map((row) => ({
        id: row.id,
        occurredAt: toIsoString(row.at),
        params: {
          offerId: row.offer_id,
          number: row.number,
          description: row.description ? row.description.slice(0, 160) : null,
          customer: row.customer,
        },
      })),
    );
  }
}
