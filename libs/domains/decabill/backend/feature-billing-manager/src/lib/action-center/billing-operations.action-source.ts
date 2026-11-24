import {
  limitActionCenterSql,
  type ActionCenterSqlRunner,
  taskGroup,
  toCount,
  toDateString,
  toIsoString,
  type ActionCenterCollectContext,
  type ActionCenterGroupDraft,
  type ActionCenterSource,
  type ActionCenterTaskDefinition,
} from '@forepath/shared/backend';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { DECABILL_ACTION_TYPES as T, PROFILE_DISPLAY_NAME_SQL } from './decabill-action-center.types';

interface SubscriptionRow {
  id: string;
  subscription_id: string;
  number: string | null;
  customer: string | null;
  label: string | null;
  error: string | null;
  at: Date | null;
  total: string;
}

/** Error texts shown in the panel are capped (provider messages can be long). */
function shortError(value: string | null): string | null {
  return value ? value.slice(0, 200) : null;
}

/**
 * Operations: provisioning that needs a human (failed servers, add-ons, configuration changes, backorders) and
 * inventory work (pending withdrawal requests, overdue lendings, articles at / below their reorder point).
 */
@Injectable()
export class BillingOperationsActionSource implements ActionCenterSource {
  readonly key = 'decabill.operations';
  readonly types = [
    T.provisioningFailed,
    T.addonsFailed,
    T.configChangesFailed,
    T.backordersFailed,
    T.withdrawalRequestsPending,
    T.lendingsOverdue,
    T.articlesLowStock,
  ];

  /** At most a few concurrent queries per source (see `limitActionCenterSql`). */
  private readonly sql: ActionCenterSqlRunner;

  constructor(dataSource: DataSource) {
    this.sql = limitActionCenterSql(dataSource);
  }

  async collect(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const groups = await Promise.all([
      this.subscriptionRows(
        { type: T.provisioningFailed, category: 'subscriptions', severity: 'danger' },
        context,
        `SELECT it.id, s.id AS subscription_id, s.number, ${PROFILE_DISPLAY_NAME_SQL('cp')} AS customer,
                COALESCE(it.display_name, it.hostname) AS label, NULL AS error, it.updated_at AS at
           FROM billing_subscription_items it
           JOIN billing_subscriptions s ON s.id = it.subscription_id AND s.status <> 'canceled'`,
        `it.provisioning_status = 'failed'`,
      ),
      this.subscriptionRows(
        { type: T.addonsFailed, category: 'subscriptions', severity: 'danger' },
        context,
        `SELECT a.id, s.id AS subscription_id, s.number, ${PROFILE_DISPLAY_NAME_SQL('cp')} AS customer,
                a.addon_name_snapshot AS label, NULL AS error, a.updated_at AS at
           FROM billing_subscription_addons a
           JOIN billing_subscriptions s ON s.id = a.subscription_id AND s.status <> 'canceled'`,
        `a.status = 'failed'`,
      ),
      this.subscriptionRows(
        { type: T.configChangesFailed, category: 'subscriptions', severity: 'warning' },
        context,
        `SELECT c.id, s.id AS subscription_id, s.number, ${PROFILE_DISPLAY_NAME_SQL('cp')} AS customer,
                c.error_code AS label, c.error_message AS error, COALESCE(c.processed_at, c.updated_at) AS at
           FROM billing_subscription_config_changes c
           JOIN billing_subscriptions s ON s.id = c.subscription_id AND s.status <> 'canceled'`,
        // Only the latest change of a subscription counts: a later successful change resolves an earlier failure.
        `c.status = 'failed' AND NOT EXISTS (
           SELECT 1 FROM billing_subscription_config_changes later
            WHERE later.subscription_id = c.subscription_id AND later.requested_at > c.requested_at
         )`,
      ),
      this.backorders(context),
      this.inventory(context),
    ]);

    return groups.flat();
  }

  private async subscriptionRows(
    definition: ActionCenterTaskDefinition,
    context: ActionCenterCollectContext,
    select: string,
    where: string,
  ): Promise<ActionCenterGroupDraft[]> {
    const rows: SubscriptionRow[] = await this.sql.query(
      `SELECT q.*, COUNT(*) OVER () AS total FROM (
         ${select}
           JOIN users u ON u.id = s.user_id AND u.tenant_id = $1
           LEFT JOIN billing_customer_profiles cp ON cp.user_id = s.user_id
          WHERE ${where}
       ) q
       ORDER BY q.at DESC NULLS LAST
       LIMIT $2`,
      [context.scopeKey, context.itemLimit],
    );

    return taskGroup(
      definition,
      toCount(rows[0]?.total),
      rows.map((row) => ({
        id: row.id,
        occurredAt: toIsoString(row.at),
        params: {
          subscriptionId: row.subscription_id,
          number: row.number,
          customer: row.customer,
          label: row.label,
          error: shortError(row.error),
        },
      })),
    );
  }

  private async backorders(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const rows: Array<{
      id: string;
      customer: string | null;
      plan: string | null;
      error: string | null;
      at: Date;
      total: string;
    }> = await this.sql.query(
      `SELECT b.id, ${PROFILE_DISPLAY_NAME_SQL('cp')} AS customer, p.name AS plan, b.failure_reason AS error,
                b.updated_at AS at, COUNT(*) OVER () AS total
           FROM billing_backorders b
           JOIN users u ON u.id = b.user_id AND u.tenant_id = $1
           LEFT JOIN billing_customer_profiles cp ON cp.user_id = b.user_id
           LEFT JOIN billing_service_plans p ON p.id = b.plan_id
          WHERE b.status = 'failed'
          ORDER BY b.updated_at DESC
          LIMIT $2`,
      [context.scopeKey, context.itemLimit],
    );

    return taskGroup(
      { type: T.backordersFailed, category: 'subscriptions', severity: 'danger' },
      toCount(rows[0]?.total),
      rows.map((row) => ({
        id: row.id,
        occurredAt: toIsoString(row.at),
        params: { customer: row.customer, plan: row.plan, error: shortError(row.error) },
      })),
    );
  }

  private async inventory(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const [requests, lendings, lowStock] = await Promise.all([
      this.sql.query(
        `SELECT r.id, a.name AS article, a.article_number, r.quantity, r.source_label, r.created_at AS at,
                COUNT(*) OVER () AS total
           FROM billing_inventory_withdrawal_requests r
           JOIN billing_inventory_articles a ON a.id = r.article_id
          WHERE r.tenant_id = $1 AND r.status = 'pending'
          ORDER BY r.created_at ASC
          LIMIT $2`,
        [context.scopeKey, context.itemLimit],
      ) as Promise<
        Array<{
          id: string;
          article: string;
          article_number: string;
          quantity: string;
          source_label: string | null;
          at: Date;
          total: string;
        }>
      >,
      this.sql.query(
        `SELECT l.id, l.document_number, a.name AS article, l.borrower_name, l.due_date, l.created_at AS at,
                COUNT(*) OVER () AS total
           FROM billing_inventory_lendings l
           JOIN billing_inventory_articles a ON a.id = l.article_id
          WHERE l.tenant_id = $1 AND l.status = 'open' AND l.due_date IS NOT NULL AND l.due_date < CURRENT_DATE
          ORDER BY l.due_date ASC
          LIMIT $2`,
        [context.scopeKey, context.itemLimit],
      ) as Promise<
        Array<{
          id: string;
          document_number: string | null;
          article: string;
          borrower_name: string | null;
          due_date: string;
          at: Date;
          total: string;
        }>
      >,
      this.sql.query(
        `SELECT q.*, COUNT(*) OVER () AS total FROM (
           SELECT a.id, a.name AS article, a.article_number, a.reorder_point, a.updated_at AS at,
                  (SELECT COALESCE(SUM(st.quantity), 0) FROM billing_inventory_stock st WHERE st.article_id = a.id) AS on_hand
             FROM billing_inventory_articles a
            WHERE a.tenant_id = $1 AND a.is_active = true AND a.reorder_point IS NOT NULL
         ) q
         WHERE q.on_hand <= q.reorder_point
         ORDER BY q.on_hand - q.reorder_point ASC, q.article ASC
         LIMIT $2`,
        [context.scopeKey, context.itemLimit],
      ) as Promise<
        Array<{
          id: string;
          article: string;
          article_number: string;
          reorder_point: string;
          on_hand: string;
          at: Date;
          total: string;
        }>
      >,
    ]);

    return [
      ...taskGroup(
        { type: T.withdrawalRequestsPending, category: 'inventory', severity: 'warning' },
        toCount(requests[0]?.total),
        requests.map((row) => ({
          id: row.id,
          occurredAt: toIsoString(row.at),
          params: {
            article: row.article,
            articleNumber: row.article_number,
            quantity: String(row.quantity),
            source: row.source_label,
          },
        })),
      ),
      ...taskGroup(
        { type: T.lendingsOverdue, category: 'inventory', severity: 'warning' },
        toCount(lendings[0]?.total),
        lendings.map((row) => ({
          id: row.id,
          occurredAt: toIsoString(row.at),
          params: {
            number: row.document_number,
            article: row.article,
            borrower: row.borrower_name,
            dueDate: toDateString(row.due_date),
          },
        })),
      ),
      ...taskGroup(
        { type: T.articlesLowStock, category: 'inventory', severity: 'info' },
        toCount(lowStock[0]?.total),
        lowStock.map((row) => ({
          id: row.id,
          occurredAt: toIsoString(row.at),
          params: {
            article: row.article,
            articleNumber: row.article_number,
            onHand: String(row.on_hand),
            reorderPoint: String(row.reorder_point),
          },
        })),
      ),
    ];
  }
}
