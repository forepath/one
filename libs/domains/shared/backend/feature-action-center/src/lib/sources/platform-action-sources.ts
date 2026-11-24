import type { UpdatesStatusSummary } from '@forepath/shared/backend/feature-updates';

import type {
  ActionCenterCollectContext,
  ActionCenterGroupDraft,
  ActionCenterSource,
  ActionCenterSqlRunner,
} from '../interfaces/action-center.types';
import { limitActionCenterSql, setupGroup, taskGroup, toCount, toIsoString } from '../utils/action-center-source.utils';

/**
 * Item types every product shares (`platform.*`). The shared frontend presents them, products only register the
 * sources they support.
 */
export const PLATFORM_ACTION_TYPES = {
  updateAvailable: 'platform.updates.available',
  webhooksFailing: 'platform.webhooks.failing',
  emailDeliveryFailed: 'platform.email.delivery_failed',
  emailNotConfigured: 'platform.setup.email',
} as const;

/** Window for failed email deliveries (older failures are history, not a to-do). */
const EMAIL_FAILURE_WINDOW_DAYS = 7;

/** Application updates (shared `feature-updates`): a newer release or outdated instances. */
export class PlatformUpdatesActionSource implements ActionCenterSource {
  readonly key = 'platform.updates';
  readonly types = [PLATFORM_ACTION_TYPES.updateAvailable];

  constructor(private readonly getStatusSummary: () => Promise<UpdatesStatusSummary>) {}

  async collect(): Promise<ActionCenterGroupDraft[]> {
    const summary = await this.getStatusSummary();
    const open = summary.updateState === 'update_available' || summary.outdatedInstanceCount > 0;

    return open
      ? taskGroup({ type: PLATFORM_ACTION_TYPES.updateAvailable, category: 'platform', severity: 'info' }, 1, [], {
          installedVersion: summary.installedVersion,
          latestVersion: summary.latestVersion,
          outdatedInstanceCount: summary.outdatedInstanceCount,
        })
      : [];
  }
}

/**
 * Webhook endpoints that fail (consecutive failures) or were disabled automatically after too many failures.
 * Shared `feature-notifications` tables, scoped by the notification scope key (tenant / instance).
 */
export class PlatformWebhooksActionSource implements ActionCenterSource {
  readonly key = 'platform.webhooks';
  readonly types = [PLATFORM_ACTION_TYPES.webhooksFailing];

  private readonly sql: ActionCenterSqlRunner;

  constructor(sql: ActionCenterSqlRunner) {
    this.sql = limitActionCenterSql(sql);
  }

  async collect(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    const rows: Array<{ id: string; name: string; enabled: boolean; consecutive_failures: number; updated_at: Date }> =
      await this.sql.query(
        `SELECT id, name, enabled, consecutive_failures, updated_at
           FROM webhook_endpoints
          WHERE scope_key = $1
            AND (consecutive_failures > 0 OR (enabled = false AND disabled_reason IS NOT NULL))
          ORDER BY updated_at DESC
          LIMIT $2`,
        [context.scopeKey, context.itemLimit],
      );

    return taskGroup(
      { type: PLATFORM_ACTION_TYPES.webhooksFailing, category: 'platform', severity: 'warning' },
      rows.length,
      rows.map((row) => ({
        id: row.id,
        occurredAt: toIsoString(row.updated_at),
        params: { name: row.name, failures: toCount(row.consecutive_failures), disabled: row.enabled === false },
      })),
    );
  }
}

/**
 * Customer / user emails that finally failed in the last days (no later success for the same event): usually a
 * broken SMTP configuration. Recipients are not exposed.
 */
export class PlatformEmailDeliveryActionSource implements ActionCenterSource {
  readonly key = 'platform.email';
  readonly types = [PLATFORM_ACTION_TYPES.emailDeliveryFailed, PLATFORM_ACTION_TYPES.emailNotConfigured];

  /**
   * @param emailConfigAudience who can fix the SMTP settings (`admin` where the settings page is admin-only)
   */
  private readonly sql: ActionCenterSqlRunner;

  constructor(
    sql: ActionCenterSqlRunner,
    private readonly emailConfigAudience: 'admin' | 'administrative' = 'admin',
  ) {
    this.sql = limitActionCenterSql(sql);
  }

  async collect(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]> {
    // `process.env` resolves settings overrides of the active scope (tenant / global / env).
    const smtpConfigured = (process.env['SMTP_HOST'] ?? '').trim().length > 0;
    const since = new Date(context.now.getTime() - EMAIL_FAILURE_WINDOW_DAYS * 86_400_000);
    const rows: Array<{ event_id: string; event_type: string; template_key: string; created_at: Date; total: string }> =
      await this.sql.query(
        `SELECT failed.event_id, failed.event_type, failed.template_key, failed.created_at,
                COUNT(*) OVER () AS total
           FROM (
             SELECT DISTINCT ON (d.event_id) d.event_id, d.event_type, d.template_key, d.created_at
               FROM email_deliveries d
              WHERE d.scope_key = $1
                AND d.success = false
                AND d.created_at >= $2
                AND NOT EXISTS (
                  SELECT 1 FROM email_deliveries ok
                   WHERE ok.event_id = d.event_id AND ok.success = true
                )
              ORDER BY d.event_id, d.created_at DESC
           ) failed
          ORDER BY failed.created_at DESC
          LIMIT $3`,
        [context.scopeKey, since, context.itemLimit],
      );

    return [
      ...setupGroup(
        {
          type: PLATFORM_ACTION_TYPES.emailNotConfigured,
          category: 'setup',
          severity: 'warning',
          audience: this.emailConfigAudience,
        },
        !smtpConfigured,
      ),
      ...taskGroup(
        { type: PLATFORM_ACTION_TYPES.emailDeliveryFailed, category: 'platform', severity: 'danger' },
        toCount(rows[0]?.total),
        rows.map((row) => ({
          id: row.event_id,
          occurredAt: toIsoString(row.created_at),
          params: { eventType: row.event_type, template: row.template_key },
        })),
      ),
    ];
  }
}
