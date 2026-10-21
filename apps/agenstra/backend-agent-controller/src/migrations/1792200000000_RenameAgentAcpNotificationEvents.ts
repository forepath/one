import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Legacy ACP notification event types → transport-neutral names (ACP transport was removed).
 * Not exported: TypeORM instantiates every export of a migration file as a migration.
 */
const AGENT_ACP_NOTIFICATION_EVENT_RENAMES: ReadonlyArray<readonly [legacy: string, current: string]> = [
  ['agent.acp.session_failed', 'agent.session_failed'],
  ['agent.acp.permission_denied', 'agent.permission_denied'],
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
 * Notification events `agent.acp.session_failed` / `agent.acp.permission_denied` are now
 * `agent.session_failed` / `agent.permission_denied`. Migrates stored webhook subscriptions (validated against the
 * event catalog, so unmigrated entries would block endpoint updates and stop deliveries) and the delivery log so
 * history stays filterable under the new names.
 */
export class RenameAgentAcpNotificationEvents1792200000000 implements MigrationInterface {
  name = 'RenameAgentAcpNotificationEvents1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.rename(queryRunner, AGENT_ACP_NOTIFICATION_EVENT_RENAMES);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.rename(
      queryRunner,
      AGENT_ACP_NOTIFICATION_EVENT_RENAMES.map(([legacy, current]) => [current, legacy] as const),
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
