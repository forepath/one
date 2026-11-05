import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Legacy Agenstra webhook event types → shared naming convention (`<resource>[.<child>].<action>`, see
 * `WEBHOOK_EVENT_TYPE_PATTERN`): no mode/qualifier segments, past-tense actions, and `environment_variable` for agent
 * environment variables ("environment" is the agent environment itself).
 * Not exported: TypeORM instantiates every export of a migration file as a migration.
 */
const AGENSTRA_NOTIFICATION_EVENT_RENAMES: ReadonlyArray<readonly [legacy: string, current: string]> = [
  ['agent.chat.failed', 'agent.chat_failed'],
  ['agent.isolation_override', 'agent.isolation_overridden'],
  ['environment.created', 'environment_variable.created'],
  ['environment.updated', 'environment_variable.updated'],
  ['environment.deleted', 'environment_variable.deleted'],
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
 * Renames Agenstra webhook event types to the shared naming convention. Migrates stored webhook subscriptions
 * (validated against the event catalog, so unmigrated entries would block endpoint updates and stop deliveries) and
 * the delivery log so history stays filterable under the new names.
 */
export class UnifyAgenstraWebhookEventNames1793800000000 implements MigrationInterface {
  name = 'UnifyAgenstraWebhookEventNames1793800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.rename(queryRunner, AGENSTRA_NOTIFICATION_EVENT_RENAMES);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.rename(
      queryRunner,
      AGENSTRA_NOTIFICATION_EVENT_RENAMES.map(([legacy, current]) => [current, legacy] as const),
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
