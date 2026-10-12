import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

/**
 * Egress guard sidecar + layered message filters.
 * - Agents track their guard container, the effective egress policy / message filter rules pushed by
 *   the controller, apply status and the guard log collection cursor.
 * - `agent_egress_events` stores aggregated guard decisions for the controller's audit ingestion.
 * - The legacy instance-wide `regex_filter_rules` table is dropped: message filters are now part of
 *   the layered agent configuration (global → workspace → environment) and arrive with config sync.
 *   Until the controller's first sync, existing agents keep enforcing the legacy rules (copied into
 *   `agents.message_filters`; invalid patterns are dropped at evaluation time).
 */
export class AddEgressGuardAndMessageFilters1792000000000 implements MigrationInterface {
  name = 'AddEgressGuardAndMessageFilters1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('agents', [
      new TableColumn({ name: 'egress_guard_container_id', type: 'varchar', length: '255', isNullable: true }),
      new TableColumn({ name: 'egress_policy', type: 'jsonb', isNullable: true }),
      new TableColumn({ name: 'egress_policy_revision', type: 'varchar', length: '64', isNullable: true }),
      new TableColumn({ name: 'egress_status', type: 'varchar', length: '16', isNullable: true }),
      new TableColumn({ name: 'egress_last_error', type: 'text', isNullable: true }),
      new TableColumn({ name: 'egress_applied_at', type: 'timestamptz', isNullable: true }),
      new TableColumn({ name: 'egress_log_cursor', type: 'varchar', length: '64', isNullable: true }),
      new TableColumn({ name: 'message_filters', type: 'jsonb', isNullable: true }),
    ]);

    await queryRunner.createTable(
      new Table({
        name: 'agent_egress_events',
        columns: [
          { name: 'seq', type: 'bigint', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'agent_id', type: 'uuid', isNullable: false },
          { name: 'kind', type: 'varchar', length: '16', isNullable: false },
          { name: 'decision', type: 'varchar', length: '16', isNullable: false },
          { name: 'host', type: 'varchar', length: '255', isNullable: true },
          { name: 'rule', type: 'varchar', length: '32', isNullable: true },
          { name: 'matched_entry', type: 'varchar', length: '255', isNullable: true },
          { name: 'matched_source', type: 'varchar', length: '16', isNullable: true },
          { name: 'method', type: 'varchar', length: '32', isNullable: true },
          { name: 'http_status', type: 'int', isNullable: true },
          { name: 'sample_url', type: 'text', isNullable: true },
          { name: 'count', type: 'int', isNullable: false, default: 1 },
          { name: 'bytes_in', type: 'bigint', isNullable: false, default: 0 },
          { name: 'bytes_out', type: 'bigint', isNullable: false, default: 0 },
          { name: 'first_seen_at', type: 'timestamptz', isNullable: false },
          { name: 'last_seen_at', type: 'timestamptz', isNullable: false },
          { name: 'mode', type: 'varchar', length: '16', isNullable: true },
          { name: 'policy_revision', type: 'varchar', length: '64', isNullable: true },
          { name: 'message', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'agent_egress_events',
      new TableIndex({ name: 'IDX_agent_egress_events_agent_last_seen', columnNames: ['agent_id', 'last_seen_at'] }),
    );
    await queryRunner.createIndex(
      'agent_egress_events',
      new TableIndex({ name: 'IDX_agent_egress_events_created_at', columnNames: ['created_at'] }),
    );

    await this.carryOverLegacyRules(queryRunner);
    await queryRunner.query('DROP TABLE IF EXISTS "regex_filter_rules"');
  }

  private async carryOverLegacyRules(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('regex_filter_rules'))) {
      return;
    }

    const rows = (await queryRunner.query(
      `SELECT "id", "pattern", "regex_flags", "direction", "filter_type", "replace_content"
       FROM "regex_filter_rules"
       ORDER BY "priority" ASC, "created_at" ASC
       LIMIT 200`,
    )) as Array<{
      id: string;
      pattern: string;
      regex_flags: string | null;
      direction: string;
      filter_type: string;
      replace_content: string | null;
    }>;

    if (rows.length === 0) {
      return;
    }

    const rules = rows.map((row, index) => {
      const action = row.filter_type === 'drop' ? 'drop' : row.filter_type === 'filter' ? 'replace' : 'flag';

      return {
        name: `Migrated rule ${index + 1} (${row.id.slice(0, 8)})`,
        pattern: row.pattern,
        flags: row.regex_flags ?? 'g',
        direction: ['incoming', 'outgoing', 'bidirectional'].includes(row.direction) ? row.direction : 'bidirectional',
        action,
        ...(action === 'replace' ? { replacement: row.replace_content ?? '' } : {}),
        enabled: true,
        source: 'global',
      };
    });

    await queryRunner.query('UPDATE "agents" SET "message_filters" = $1 WHERE "message_filters" IS NULL', [
      JSON.stringify(rules),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "regex_filter_rules" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "pattern" text NOT NULL,
        "regex_flags" varchar(16) NOT NULL DEFAULT 'g',
        "direction" varchar(32) NOT NULL,
        "filter_type" varchar(16) NOT NULL,
        "replace_content" text NULL,
        "priority" int NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_regex_filter_rules_priority" ON "regex_filter_rules" ("priority", "created_at")',
    );
    await queryRunner.dropIndex('agent_egress_events', 'IDX_agent_egress_events_created_at');
    await queryRunner.dropIndex('agent_egress_events', 'IDX_agent_egress_events_agent_last_seen');
    await queryRunner.dropTable('agent_egress_events');

    for (const column of [
      'message_filters',
      'egress_log_cursor',
      'egress_applied_at',
      'egress_last_error',
      'egress_status',
      'egress_policy_revision',
      'egress_policy',
      'egress_guard_container_id',
    ]) {
      await queryRunner.dropColumn('agents', column);
    }
  }
}
