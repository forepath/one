import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Legacy Decabill webhook event types → shared naming convention (`<resource>[.<child>].<action>`, see
 * `WEBHOOK_EVENT_TYPE_PATTERN`): modes / addon keys move out of the type into the payload, and attachments use the
 * cross-application `attachment.*` events (payload carries `ownerType` / `ownerId`).
 * Not exported: TypeORM instantiates every export of a migration file as a migration.
 */
const BILLING_NOTIFICATION_EVENT_RENAMES: ReadonlyArray<readonly [legacy: string, current: string]> = [
  ['payment.auto.initiated', 'payment.auto_initiated'],
  ['payment.auto.retry_scheduled', 'payment.auto_retry_scheduled'],
  ['payment.auto.exhausted', 'payment.auto_exhausted'],
  ['addon.container_manager.collection_failed', 'addon.collection_failed'],
  ['ticket.attachment.created', 'attachment.created'],
  ['ticket.attachment.deleted', 'attachment.deleted'],
];

/**
 * Builds the `webhook_endpoints.subscribed_events` rewrite: renames each `from` entry to its `to` counterpart and
 * de-duplicates (an endpoint may already have subscribed to both spellings). Only touches affected rows.
 */
function buildSubscribedEventsRenameSql(renames: ReadonlyArray<readonly [from: string, to: string]>): {
  sql: string;
  parameters: string[];
} {
  const parameters: string[] = [];
  const cases = renames
    .map(([from, to]) => {
      parameters.push(from, to);

      return `WHEN value = $${parameters.length - 1} THEN $${parameters.length}`;
    })
    .join(' ');
  const fromParams = renames.map((_, index) => `$${index * 2 + 1}`).join(', ');

  return {
    sql: `
      UPDATE "webhook_endpoints"
      SET "subscribed_events" = COALESCE(
        (
          SELECT jsonb_agg(DISTINCT CASE ${cases} ELSE value END)
          FROM jsonb_array_elements_text("subscribed_events") AS value
        ),
        '[]'::jsonb
      )
      WHERE "subscribed_events" ?| ARRAY[${fromParams}]::text[]
    `,
    parameters,
  };
}

/**
 * Renames Decabill webhook event types to the shared naming convention. Migrates stored webhook subscriptions
 * (validated against the event catalog, so unmigrated entries would block endpoint updates and stop deliveries) and
 * the delivery log so history stays filterable under the new names.
 */
export class UnifyBillingWebhookEventNames1793800000000 implements MigrationInterface {
  name = 'UnifyBillingWebhookEventNames1793800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.rename(queryRunner, BILLING_NOTIFICATION_EVENT_RENAMES);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.rename(
      queryRunner,
      BILLING_NOTIFICATION_EVENT_RENAMES.map(([legacy, current]) => [current, legacy] as const),
    );
  }

  private async rename(queryRunner: QueryRunner, renames: ReadonlyArray<readonly [string, string]>): Promise<void> {
    if (await queryRunner.hasTable('webhook_endpoints')) {
      const { sql, parameters } = buildSubscribedEventsRenameSql(renames);

      await queryRunner.query(sql, parameters);
    }

    if (await queryRunner.hasTable('webhook_deliveries')) {
      for (const [from, to] of renames) {
        await queryRunner.query('UPDATE "webhook_deliveries" SET "event_type" = $2 WHERE "event_type" = $1', [
          from,
          to,
        ]);
      }
    }
  }
}
