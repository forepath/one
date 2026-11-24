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
} from '@forepath/shared/backend';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  DECABILL_ACTION_TYPES as T,
  PROFILE_DISPLAY_NAME_SQL,
  PROFILE_INCOMPLETE_SQL,
} from './decabill-action-center.types';

/** Supplier invoices due within this many days are flagged (overdue ones always). */
const PAYABLE_DUE_WARNING_DAYS = 3;

/**
 * Business partners: incomplete / invalid customer profiles (only customers with business: a live subscription or an
 * open document) and suppliers, plus supplier invoices (drafts, due / overdue payables, missing original receipt).
 */
@Injectable()
export class BillingPartnersActionSource implements ActionCenterSource {
  readonly key = 'decabill.partners';
  readonly types = [
    T.customersIncomplete,
    T.customersVatInvalid,
    T.suppliersIncomplete,
    T.supplierInvoicesDraft,
    T.supplierInvoicesDue,
    T.supplierInvoicesMissingDocument,
  ];

  /** At most a few concurrent queries per source (see `limitActionCenterSql`). */
  private readonly sql: ActionCenterSqlRunner;

  constructor(dataSource: DataSource) {
    this.sql = limitActionCenterSql(dataSource);
  }

  async collect(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const groups = await Promise.all([
      this.customers(context),
      this.vatInvalid(context),
      this.suppliers(context),
      this.payables(context),
    ]);

    return groups.flat();
  }

  private async customers(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const rows: Array<{
      id: string;
      number: string | null;
      name: string | null;
      email: string | null;
      at: Date;
      total: string;
    }> = await this.sql.query(
      `SELECT cp.id, cp.customer_number AS number, ${PROFILE_DISPLAY_NAME_SQL('cp')} AS name, u.email,
                cp.updated_at AS at, COUNT(*) OVER () AS total
           FROM billing_customer_profiles cp
           JOIN users u ON u.id = cp.user_id AND u.tenant_id = $1
          WHERE (${PROFILE_INCOMPLETE_SQL('cp')})
            AND (
              EXISTS (SELECT 1 FROM billing_subscriptions s WHERE s.user_id = cp.user_id AND s.status <> 'canceled')
              OR EXISTS (
                SELECT 1 FROM billing_invoices i
                 WHERE i.user_id = cp.user_id AND i.status IN ('draft', 'issued', 'partially_paid', 'overdue')
              )
              OR EXISTS (SELECT 1 FROM billing_offers o WHERE o.user_id = cp.user_id AND o.status IN ('draft', 'archived'))
            )
          ORDER BY cp.updated_at DESC
          LIMIT $2`,
      [context.scopeKey, context.itemLimit],
    );

    return taskGroup(
      { type: T.customersIncomplete, category: 'customers', severity: 'warning' },
      toCount(rows[0]?.total),
      rows.map((row) => ({
        id: row.id,
        occurredAt: toIsoString(row.at),
        params: { number: row.number, name: row.name ?? row.email },
      })),
    );
  }

  private async vatInvalid(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const rows: Array<{
      id: string;
      kind: string;
      number: string | null;
      name: string | null;
      vat_id: string | null;
      at: Date;
      total: string;
    }> = await this.sql.query(
      `SELECT p.id, p.kind, p.number, p.name, p.vat_id, p.at, COUNT(*) OVER () AS total
           FROM (
             SELECT cp.id, 'customer' AS kind, cp.customer_number AS number, ${PROFILE_DISPLAY_NAME_SQL('cp')} AS name,
                    cp.vat_id, COALESCE(cp.vat_id_validated_at, cp.updated_at) AS at
               FROM billing_customer_profiles cp
               JOIN users u ON u.id = cp.user_id AND u.tenant_id = $1
              WHERE cp.vat_id_validation_status = 'invalid'
             UNION ALL
             SELECT sp.id, 'supplier' AS kind, sp.supplier_number AS number, ${PROFILE_DISPLAY_NAME_SQL('sp')} AS name,
                    sp.vat_id, COALESCE(sp.vat_id_validated_at, sp.updated_at) AS at
               FROM billing_supplier_profiles sp
              WHERE sp.tenant_id = $1 AND sp.vat_id_validation_status = 'invalid'
           ) p
          ORDER BY p.at DESC
          LIMIT $2`,
      [context.scopeKey, context.itemLimit],
    );

    return taskGroup(
      { type: T.customersVatInvalid, category: 'customers', severity: 'warning' },
      toCount(rows[0]?.total),
      rows.map((row) => ({
        id: `${row.kind}:${row.id}`,
        occurredAt: toIsoString(row.at),
        params: { kind: row.kind, profileId: row.id, number: row.number, name: row.name, vatId: row.vat_id },
      })),
    );
  }

  private async suppliers(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const rows: Array<{ id: string; number: string | null; name: string | null; at: Date; total: string }> =
      await this.sql.query(
        `SELECT sp.id, sp.supplier_number AS number, ${PROFILE_DISPLAY_NAME_SQL('sp')} AS name, sp.updated_at AS at,
                COUNT(*) OVER () AS total
           FROM billing_supplier_profiles sp
          WHERE sp.tenant_id = $1
            AND (
              -- a name: the company or first and last name
              (COALESCE(TRIM(sp.company), '') = ''
                AND (COALESCE(TRIM(sp.first_name), '') = '' OR COALESCE(TRIM(sp.last_name), '') = ''))
              -- and a postal address (DATEV creditor data, documents)
              OR COALESCE(TRIM(sp.address_line_1), '') = ''
              OR COALESCE(TRIM(sp.postal_code), '') = ''
              OR COALESCE(TRIM(sp.city), '') = ''
              OR COALESCE(TRIM(sp.country), '') = ''
            )
          ORDER BY sp.updated_at DESC
          LIMIT $2`,
        [context.scopeKey, context.itemLimit],
      );

    return taskGroup(
      { type: T.suppliersIncomplete, category: 'payables', severity: 'info' },
      toCount(rows[0]?.total),
      rows.map((row) => ({
        id: row.id,
        occurredAt: toIsoString(row.at),
        params: { number: row.number, name: row.name },
      })),
    );
  }

  private async payables(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const dueUntil = new Date(context.now.getTime() + PAYABLE_DUE_WARNING_DAYS * 86_400_000);
    const rows: Array<{
      id: string;
      kind: 'draft' | 'due' | 'missing_document';
      number: string | null;
      supplier: string | null;
      total_gross: string | null;
      balance_due: string | null;
      currency: string | null;
      due_date: string | Date | null;
      overdue: boolean;
      at: Date | null;
      total: string;
      rn: string;
    }> = await this.sql.query(
      `SELECT * FROM (
         SELECT x.*, COUNT(*) OVER (PARTITION BY x.kind) AS total,
                ROW_NUMBER() OVER (
                  PARTITION BY x.kind
                  ORDER BY CASE WHEN x.kind = 'due' THEN x.due_date END ASC NULLS LAST, x.at DESC NULLS LAST
                ) AS rn
           FROM (
             SELECT si.id, k.kind, si.invoice_number AS number, ${PROFILE_DISPLAY_NAME_SQL('sp')} AS supplier,
                    si.total_gross, si.balance_due, si.currency, si.due_date,
                    (si.status = 'overdue' OR si.due_date < CURRENT_DATE) AS overdue,
                    COALESCE(si.issued_at, si.created_at) AS at
               FROM billing_supplier_invoices si
               JOIN billing_supplier_profiles sp ON sp.id = si.supplier_id AND sp.tenant_id = $1
               CROSS JOIN LATERAL (
                 SELECT 'draft' AS kind WHERE si.status = 'draft'
                 UNION ALL
                 SELECT 'due' WHERE si.status IN ('issued', 'partially_paid', 'overdue') AND si.due_date <= $3::date
                 UNION ALL
                 SELECT 'missing_document' WHERE si.status NOT IN ('draft', 'void') AND si.has_uploaded_document = false
               ) k
           ) x
       ) ranked
       WHERE ranked.rn <= $2
       ORDER BY ranked.kind, ranked.rn`,
      [context.scopeKey, context.itemLimit, toDateString(dueUntil)],
    );
    const byKind = (kind: (typeof rows)[number]['kind']) => rows.filter((row) => row.kind === kind);
    const toItems = (list: typeof rows) =>
      list.map((row) => ({
        id: row.id,
        occurredAt: toIsoString(row.at),
        params: {
          number: row.number,
          supplier: row.supplier,
          totalGross: toDecimalString(row.total_gross),
          balanceDue: toDecimalString(row.balance_due),
          currency: row.currency,
          dueDate: toDateString(row.due_date),
          overdue: row.overdue === true,
        },
      }));
    const drafts = byKind('draft');
    const due = byKind('due');
    const missing = byKind('missing_document');

    return [
      ...taskGroup(
        { type: T.supplierInvoicesDraft, category: 'payables', severity: 'info' },
        toCount(drafts[0]?.total),
        toItems(drafts),
      ),
      ...taskGroup(
        {
          type: T.supplierInvoicesDue,
          category: 'payables',
          severity: due.some((row) => row.overdue === true) ? 'danger' : 'warning',
        },
        toCount(due[0]?.total),
        toItems(due),
      ),
      ...taskGroup(
        { type: T.supplierInvoicesMissingDocument, category: 'payables', severity: 'info' },
        toCount(missing[0]?.total),
        toItems(missing),
      ),
    ];
  }
}
