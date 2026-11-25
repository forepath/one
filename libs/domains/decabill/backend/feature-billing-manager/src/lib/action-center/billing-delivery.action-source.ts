import {
  limitActionCenterSql,
  type ActionCenterSqlRunner,
  taskGroup,
  toCount,
  toIsoString,
  type ActionCenterCollectContext,
  type ActionCenterGroupDraft,
  type ActionCenterSource,
} from '@forepath/shared/backend';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { DECABILL_ACTION_TYPES as T } from './decabill-action-center.types';

function shortText(value: string | null): string | null {
  return value ? value.slice(0, 200) : null;
}

/**
 * Delivery: spool jobs that failed for good (printouts and sends; a failed send left its document unsent) and letters
 * the postal provider could not process or deliver. Scoped to the tenant through the rows' `tenant_id`.
 */
@Injectable()
export class BillingDeliveryActionSource implements ActionCenterSource {
  readonly key = 'decabill.delivery';
  readonly types = [T.spoolJobsFailed, T.lettersAttention];

  private readonly sql: ActionCenterSqlRunner;

  constructor(dataSource: DataSource) {
    this.sql = limitActionCenterSql(dataSource);
  }

  async collect(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const [spool, letters] = await Promise.all([this.spoolJobs(context), this.letters(context)]);

    return [...spool, ...letters];
  }

  private async spoolJobs(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const rows: Array<{ id: string; title: string; kind: string; error: string | null; at: Date; total: string }> =
      await this.sql.query(
        `SELECT j.id, j.title, j.kind, j.error, COALESCE(j.finished_at, j.updated_at) AS at, COUNT(*) OVER () AS total
           FROM billing_spool_jobs j
          WHERE j.tenant_id = $1 AND j.status = 'failed'
          ORDER BY at DESC
          LIMIT $2`,
        [context.scopeKey, context.itemLimit],
      );

    return taskGroup(
      { type: T.spoolJobsFailed, category: 'platform', severity: 'danger' },
      toCount(rows[0]?.total),
      rows.map((row) => ({
        id: row.id,
        occurredAt: toIsoString(row.at),
        params: { title: row.title, kind: row.kind, error: shortText(row.error) },
      })),
    );
  }

  private async letters(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const rows: Array<{
      id: string;
      document_type: string;
      document_id: string;
      number: string | null;
      status: string;
      reason: string | null;
      at: Date;
      total: string;
    }> = await this.sql.query(
      `SELECT l.id, l.document_type, l.document_id, l.document_number AS number, l.status,
              l.status_reason AS reason, l.updated_at AS at, COUNT(*) OVER () AS total
         FROM billing_postal_letters l
        WHERE l.tenant_id = $1 AND l.status IN ('action_required', 'undeliverable')
          -- Resolved once the document went out again (another letter, email or marked as sent); supplementary letters
          -- (customer preference, in addition to the email) stay listed until silenced.
          AND (
            l.supplementary
            OR (
              CASE l.document_type
                WHEN 'invoice' THEN (SELECT i.sent_at FROM billing_invoices i WHERE i.id = l.document_id)
                WHEN 'credit_note' THEN (SELECT i.void_document_sent_at FROM billing_invoices i WHERE i.id = l.document_id)
                ELSE (SELECT o.sent_at FROM billing_offers o WHERE o.id = l.document_id)
              END
            ) IS NOT DISTINCT FROM (CASE WHEN l.status = 'action_required' THEN NULL ELSE l.claimed_at END)
          )
        ORDER BY l.updated_at DESC
        LIMIT $2`,
      [context.scopeKey, context.itemLimit],
    );

    return taskGroup(
      { type: T.lettersAttention, category: 'receivables', severity: 'warning' },
      toCount(rows[0]?.total),
      rows.map((row) => ({
        id: row.id,
        occurredAt: toIsoString(row.at),
        params: {
          documentType: row.document_type,
          documentId: row.document_id,
          number: row.number,
          status: row.status,
          reason: shortText(row.reason),
        },
      })),
    );
  }
}
