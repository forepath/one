import {
  limitActionCenterSql,
  type ActionCenterSqlRunner,
  missingSettings,
  setupGroup,
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

import { AccountingConfigService } from '../accounting/services/accounting-config.service';
import { DatevExportConfigService } from '../services/datev-export-config.service';
import { TenantsGlobalViewsConfigService } from '../services/tenants-global-views-config.service';
import { parseBooleanEnv } from '../utils/datev-format.util';

import { DECABILL_ACTION_TYPES as T } from './decabill-action-center.types';

/** Issuer fields every invoice needs (`BillingIssuerConfigService.assertConfigured`). */
const ISSUER_REQUIRED_SETTINGS = [
  'BILLING_ISSUER_NAME',
  'BILLING_ISSUER_VAT_ID',
  'BILLING_ISSUER_ADDRESS_LINE1',
  'BILLING_ISSUER_POSTAL_CODE',
  'BILLING_ISSUER_CITY',
] as const;
/** Issuer fields customers need to pay / reach the issuer (printed on documents). */
const ISSUER_DETAIL_SETTINGS = ['BILLING_ISSUER_EMAIL', 'BILLING_ISSUER_IBAN', 'BILLING_ISSUER_BIC'] as const;
/** Failed bank imports and DATEV runs older than this are history. */
const RECENT_FAILURE_DAYS = 30;

/**
 * Setup suggestions (issuer, accounting and DATEV configuration, first customer) and the to-dos of the optional
 * features: accounting (only with `BILLING_ACCOUNTING_ENABLED` and complete prerequisites) and DATEV exports (only with
 * `BILLING_DATEV_EXPORT_ENABLED`). Settings live on the admin-only settings page, so setup items that are fixed there
 * are `admin` items. Entity-wide accounting records (posting issues, VAT returns, bank lines without tenant) only show
 * for tenants allowed to use global views (`TENANTS_ALLOW_GLOBAL_VIEWS`).
 */
@Injectable()
export class BillingSetupActionSource implements ActionCenterSource {
  readonly key = 'decabill.setup';
  readonly types = [
    T.setupIssuer,
    T.setupIssuerDetails,
    T.setupAccounting,
    T.setupDatev,
    T.setupFirstCustomer,
    T.accountingUnbooked,
    T.accountingPostingIssues,
    T.accountingBankUnmatched,
    T.accountingBankSuggested,
    T.accountingBankImportFailed,
    T.accountingVatReturnsDue,
    T.datevExportFailed,
  ];

  /** At most a few concurrent queries per source (see `limitActionCenterSql`). */
  private readonly sql: ActionCenterSqlRunner;

  constructor(
    dataSource: DataSource,
    private readonly accountingConfig: AccountingConfigService,
    private readonly datevConfig: DatevExportConfigService,
    private readonly globalViews: TenantsGlobalViewsConfigService,
  ) {
    this.sql = limitActionCenterSql(dataSource);
  }

  async collect(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const tenantId = context.scopeKey;
    const global = this.globalViews.isGlobalViewsAllowedForTenant(tenantId);
    const accountingRequested = parseBooleanEnv('BILLING_ACCOUNTING_ENABLED', false);
    const accountingMissing = this.accountingConfig
      .getMissingCorePrerequisites()
      .filter((key) => key !== 'BILLING_ACCOUNTING_ENABLED');
    const datevEnabled = this.datevConfig.isEnabled();
    const issuerMissing = missingSettings(ISSUER_REQUIRED_SETTINGS);
    const detailsMissing = missingSettings(ISSUER_DETAIL_SETTINGS);
    const [customerCount, accounting, datev] = await Promise.all([
      this.customerCount(tenantId),
      this.accountingConfig.isEnabled() ? this.accounting(context, global) : Promise.resolve([]),
      datevEnabled ? this.datevFailures(context) : Promise.resolve([]),
    ]);

    return [
      ...setupGroup(
        { type: T.setupIssuer, category: 'setup', severity: 'warning', audience: 'admin' },
        issuerMissing.length > 0,
        { missing: issuerMissing.join(', ') },
      ),
      ...setupGroup(
        { type: T.setupIssuerDetails, category: 'setup', severity: 'info', audience: 'admin' },
        detailsMissing.length > 0,
        { missing: detailsMissing.join(', ') },
      ),
      ...setupGroup(
        { type: T.setupAccounting, category: 'setup', severity: 'warning', audience: 'admin' },
        accountingRequested && accountingMissing.length > 0,
        { missing: accountingMissing.join(', ') },
      ),
      ...setupGroup(
        { type: T.setupDatev, category: 'setup', severity: 'info', audience: 'admin' },
        datevEnabled && this.datevConfig.resolveForTenant(tenantId) === null,
      ),
      ...setupGroup({ type: T.setupFirstCustomer, category: 'setup', severity: 'info' }, customerCount === 0),
      ...accounting,
      ...datev,
    ];
  }

  private async customerCount(tenantId: string): Promise<number> {
    const [row]: Array<{ count: string }> = await this.sql.query(
      `SELECT COUNT(*) AS count
         FROM billing_customer_profiles cp
         JOIN users u ON u.id = cp.user_id AND u.tenant_id = $1
        WHERE u.role = 'user'`,
      [tenantId],
    );

    return toCount(row?.count);
  }

  private async accounting(context: ActionCenterCollectContext, global: boolean): Promise<ActionCenterGroupDraft[]> {
    const start = this.accountingConfig.getConfig().startDate;
    const since = new Date(context.now.getTime() - RECENT_FAILURE_DAYS * 86_400_000);
    // Bank lines / imports without tenant belong to the whole entity.
    const bankTenantFilter = global ? `(t.tenant_id = $1 OR t.tenant_id IS NULL)` : `t.tenant_id = $1`;
    const [unbooked, issues, bank, imports, vatReturns] = await Promise.all([
      this.sql.query(
        `SELECT q.*, COUNT(*) OVER () AS total FROM (
           SELECT i.id, 'invoice' AS kind, i.invoice_number AS number, i.total_gross, i.currency,
                  COALESCE(i.voided_at, i.issued_at) AS at
             FROM billing_invoices i
             JOIN users u ON u.id = i.user_id AND u.tenant_id = $1
            WHERE i.status <> 'draft' AND i.issued_at IS NOT NULL AND i.issued_at::date >= $2::date
              AND i.total_gross <> 0
              AND (
                NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key = 'invoice:' || i.id || ':issued')
                OR (i.status = 'void' AND i.invoice_number IS NOT NULL AND i.voided_at IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key = 'invoice:' || i.id || ':voided'))
              )
           UNION ALL
           SELECT s.id, 'supplier_invoice' AS kind, s.invoice_number AS number, s.total_gross, s.currency,
                  COALESCE(s.voided_at, s.issued_at) AS at
             FROM billing_supplier_invoices s
             JOIN billing_supplier_profiles sp ON sp.id = s.supplier_id AND sp.tenant_id = $1
            WHERE s.status <> 'draft' AND COALESCE(s.issue_date, s.issued_at::date) >= $2::date AND s.total_gross <> 0
              AND (
                NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key = 'supplier_invoice:' || s.id || ':issued')
                OR (s.status = 'void' AND s.voided_at IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM billing_accounting_journal_entries e WHERE e.idempotency_key = 'supplier_invoice:' || s.id || ':voided'))
              )
         ) q
         ORDER BY q.at DESC NULLS LAST
         LIMIT $3`,
        [context.scopeKey, start, context.itemLimit],
      ) as Promise<
        Array<{
          id: string;
          kind: string;
          number: string | null;
          total_gross: string;
          currency: string;
          at: Date;
          total: string;
        }>
      >,
      this.sql.query(
        `SELECT p.id, p.source_type, p.source_id, p.source_event, p.error, p.attempts, p.updated_at AS at,
                COUNT(*) OVER () AS total
           FROM billing_accounting_posting_issues p
          WHERE p.resolved_at IS NULL AND ${global ? '(p.tenant_id = $1 OR p.tenant_id IS NULL)' : 'p.tenant_id = $1'}
          ORDER BY p.updated_at DESC
          LIMIT $2`,
        [context.scopeKey, context.itemLimit],
      ) as Promise<
        Array<{
          id: string;
          source_type: string;
          source_id: string;
          source_event: string;
          error: string;
          attempts: number;
          at: Date;
          total: string;
        }>
      >,
      this.sql.query(
        `SELECT * FROM (
           SELECT t.id, t.match_status, t.booking_date, t.amount, t.currency, t.counterparty_name, t.remittance,
                  t.created_at AS at, COUNT(*) OVER (PARTITION BY t.match_status) AS total,
                  ROW_NUMBER() OVER (PARTITION BY t.match_status ORDER BY t.booking_date DESC, t.id) AS rn
             FROM billing_accounting_bank_transactions t
            WHERE ${bankTenantFilter} AND t.status = 'booked' AND t.match_status IN ('unmatched', 'suggested')
         ) ranked
         WHERE ranked.rn <= $2
         ORDER BY ranked.match_status, ranked.rn`,
        [context.scopeKey, context.itemLimit],
      ) as Promise<
        Array<{
          id: string;
          match_status: 'unmatched' | 'suggested';
          booking_date: string;
          amount: string;
          currency: string;
          counterparty_name: string | null;
          remittance: string | null;
          at: Date;
          total: string;
        }>
      >,
      this.sql.query(
        `SELECT t.id, t.file_name, t.format, t.error_message, t.created_at AS at, COUNT(*) OVER () AS total
           FROM billing_accounting_bank_imports t
          WHERE ${bankTenantFilter} AND t.status = 'failed' AND t.created_at >= $3
          ORDER BY t.created_at DESC
          LIMIT $2`,
        [context.scopeKey, context.itemLimit, since],
      ) as Promise<
        Array<{
          id: string;
          file_name: string;
          format: string | null;
          error_message: string | null;
          at: Date;
          total: string;
        }>
      >,
      // VAT returns are entity-wide: only tenants with global views file them.
      global
        ? (this.sql.query(
            `SELECT v.id, v.definition_key, v.period_start, v.period_end, v.result_amount, v.updated_at AS at,
                    COUNT(*) OVER () AS total
               FROM billing_accounting_vat_returns v
              WHERE v.status = 'draft' AND v.period_end < CURRENT_DATE
              ORDER BY v.period_end ASC
              LIMIT $1`,
            [context.itemLimit],
          ) as Promise<
            Array<{
              id: string;
              definition_key: string;
              period_start: string;
              period_end: string;
              result_amount: string | null;
              at: Date;
              total: string;
            }>
          >)
        : Promise.resolve([]),
    ]);
    const bankItems = (status: 'unmatched' | 'suggested') => bank.filter((row) => row.match_status === status);
    const toBankItems = (rows: typeof bank) =>
      rows.map((row) => ({
        id: row.id,
        occurredAt: toIsoString(row.at),
        params: {
          bookingDate: toDateString(row.booking_date),
          amount: toDecimalString(row.amount),
          currency: row.currency,
          counterparty: row.counterparty_name,
          remittance: row.remittance ? row.remittance.slice(0, 140) : null,
        },
      }));

    return [
      ...taskGroup(
        { type: T.accountingUnbooked, category: 'accounting', severity: 'danger' },
        toCount(unbooked[0]?.total),
        unbooked.map((row) => ({
          id: `${row.kind}:${row.id}`,
          occurredAt: toIsoString(row.at),
          params: {
            kind: row.kind,
            documentId: row.id,
            number: row.number,
            totalGross: toDecimalString(row.total_gross),
            currency: row.currency,
          },
        })),
      ),
      ...taskGroup(
        { type: T.accountingPostingIssues, category: 'accounting', severity: 'danger' },
        toCount(issues[0]?.total),
        issues.map((row) => ({
          id: row.id,
          occurredAt: toIsoString(row.at),
          params: {
            sourceType: row.source_type,
            sourceEvent: row.source_event,
            attempts: Number(row.attempts) || 0,
            error: row.error ? row.error.slice(0, 200) : null,
          },
        })),
      ),
      ...taskGroup(
        { type: T.accountingBankUnmatched, category: 'accounting', severity: 'warning' },
        toCount(bankItems('unmatched')[0]?.total),
        toBankItems(bankItems('unmatched')),
      ),
      ...taskGroup(
        { type: T.accountingBankSuggested, category: 'accounting', severity: 'info' },
        toCount(bankItems('suggested')[0]?.total),
        toBankItems(bankItems('suggested')),
      ),
      ...taskGroup(
        { type: T.accountingBankImportFailed, category: 'accounting', severity: 'danger' },
        toCount(imports[0]?.total),
        imports.map((row) => ({
          id: row.id,
          occurredAt: toIsoString(row.at),
          params: {
            fileName: row.file_name,
            format: row.format,
            error: row.error_message ? row.error_message.slice(0, 200) : null,
          },
        })),
      ),
      ...taskGroup(
        { type: T.accountingVatReturnsDue, category: 'accounting', severity: 'warning' },
        toCount(vatReturns[0]?.total),
        vatReturns.map((row) => ({
          id: row.id,
          occurredAt: toIsoString(row.at),
          params: {
            definition: row.definition_key,
            periodStart: toDateString(row.period_start),
            periodEnd: toDateString(row.period_end),
            resultAmount: toDecimalString(row.result_amount),
          },
        })),
      ),
    ];
  }

  private async datevFailures(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const since = new Date(context.now.getTime() - RECENT_FAILURE_DAYS * 86_400_000);
    const rows: Array<{
      id: string;
      period_year: number;
      period_month: number;
      error_message: string | null;
      at: Date;
      total: string;
    }> = await this.sql.query(
      `SELECT x.id, x.period_year, x.period_month, x.error_message, x.created_at AS at, COUNT(*) OVER () AS total
           FROM billing_datev_exports x
          WHERE x.tenant_id = $1 AND x.status = 'failed' AND x.created_at >= $3
            AND NOT EXISTS (
              SELECT 1 FROM billing_datev_exports later
               WHERE later.tenant_id = x.tenant_id AND later.period_year = x.period_year
                 AND later.period_month = x.period_month AND later.created_at > x.created_at
            )
          ORDER BY x.created_at DESC
          LIMIT $2`,
      [context.scopeKey, context.itemLimit, since],
    );

    return taskGroup(
      { type: T.datevExportFailed, category: 'accounting', severity: 'danger' },
      toCount(rows[0]?.total),
      rows.map((row) => ({
        id: row.id,
        occurredAt: toIsoString(row.at),
        params: {
          period: `${row.period_year}-${String(row.period_month).padStart(2, '0')}`,
          error: row.error_message ? row.error_message.slice(0, 200) : null,
        },
      })),
    );
  }
}
