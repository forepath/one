import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

const MAX_RULES_PER_LAYER = 200;
const MAX_PATTERN_LENGTH = 2000;
const MAX_REPLACEMENT_LENGTH = 2000;

interface LegacyRuleRow {
  id: string;
  pattern: string;
  regex_flags: string | null;
  direction: string;
  filter_type: string;
  replace_content: string | null;
  priority: number;
  enabled: boolean;
  is_global: boolean;
}

interface MessageFilterRule {
  name: string;
  pattern: string;
  flags: string;
  direction: string;
  action: 'drop' | 'replace' | 'flag';
  replacement?: string;
  enabled: boolean;
}

/** Index of the first body character of a group opened at `index` (skips `?:`, `?=`, `?<name>`, …). */
function groupBodyStart(pattern: string, index: number): number {
  if (pattern[index + 1] !== '?') {
    return index + 1;
  }

  const next = pattern[index + 2];

  if (next === ':' || next === '=' || next === '!') {
    return index + 3;
  }

  if (next === '<') {
    const after = pattern[index + 3];

    if (after === '=' || after === '!') {
      return index + 4;
    }

    const close = pattern.indexOf('>', index + 3);

    return close === -1 ? index + 3 : close + 1;
  }

  return index + 2;
}

function hasAmbiguousAlternation(pattern: string, branchStarts: readonly number[]): boolean {
  if (branchStarts.length < 2) {
    return false;
  }

  const seen = new Set<string>();

  for (const start of branchStarts) {
    const char = pattern[start];

    if (char === undefined || '|)\\[(.^$*+?{'.includes(char)) {
      return true;
    }

    const key = char.toLowerCase();

    if (seen.has(key)) {
      return true;
    }

    seen.add(key);
  }

  return false;
}

/**
 * Same heuristic as the shared util (`hasNestedQuantifier`, frozen copy for this migration):
 * rejected rules would block later saves of the layer.
 */
function hasNestedQuantifier(pattern: string): boolean {
  const stack: Array<{ quantified: boolean; branchStarts: number[] }> = [];
  let escaped = false;
  let inClass = false;

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (inClass) {
      if (char === ']') {
        inClass = false;
      }

      continue;
    }

    if (char === '[') {
      inClass = true;
      continue;
    }

    if (char === '(') {
      stack.push({ quantified: false, branchStarts: [groupBodyStart(pattern, index)] });
      continue;
    }

    if (char === '|') {
      stack[stack.length - 1]?.branchStarts.push(index + 1);
      continue;
    }

    if (char === ')') {
      const group = stack.pop();
      const next = pattern[index + 1];
      const groupQuantified = next === '+' || next === '*' || next === '{' || next === '?';

      if (group?.quantified && groupQuantified && next !== '?') {
        return true;
      }

      if (group && groupQuantified && next !== '?' && hasAmbiguousAlternation(pattern, group.branchStarts)) {
        return true;
      }

      if ((group?.quantified || groupQuantified) && stack.length > 0) {
        stack[stack.length - 1].quantified = true;
      }

      continue;
    }

    if ((char === '+' || char === '*' || char === '{') && stack.length > 0) {
      stack[stack.length - 1].quantified = true;
    }
  }

  return false;
}

function normalizeFlags(raw: string | null): string | null {
  const allowed = new Set(['g', 'i', 'm', 's', 'u', 'y', 'd']);
  let out = '';

  for (const char of (raw ?? 'g').trim()) {
    if (!allowed.has(char)) {
      return null;
    }

    if (!out.includes(char)) {
      out += char;
    }
  }

  return out;
}

function toMessageFilterRule(row: LegacyRuleRow, index: number): MessageFilterRule | null {
  const flags = normalizeFlags(row.regex_flags);

  if (!flags || !row.pattern || row.pattern.length > MAX_PATTERN_LENGTH || hasNestedQuantifier(row.pattern)) {
    return null;
  }

  try {
    new RegExp(row.pattern, flags);
  } catch {
    return null;
  }

  const direction = ['incoming', 'outgoing', 'bidirectional'].includes(row.direction) ? row.direction : 'bidirectional';
  const action = row.filter_type === 'drop' ? 'drop' : row.filter_type === 'filter' ? 'replace' : 'flag';

  return {
    name: `Migrated rule ${index + 1} (${row.id.slice(0, 8)})`,
    pattern: row.pattern,
    flags,
    direction,
    action,
    ...(action === 'replace' ? { replacement: (row.replace_content ?? '').slice(0, MAX_REPLACEMENT_LENGTH) } : {}),
    enabled: row.enabled !== false,
  };
}

function mergeRules(config: unknown, rules: MessageFilterRule[]): Record<string, unknown> {
  const base =
    config && typeof config === 'object' && !Array.isArray(config) ? { ...(config as Record<string, unknown>) } : {};
  const existing = Array.isArray(base['message_filters']) ? (base['message_filters'] as unknown[]) : [];

  base['message_filters'] = [...existing, ...rules].slice(0, MAX_RULES_PER_LAYER);

  return base;
}

/**
 * Layered platform security policies (agent configuration → Security):
 * - `statistics_egress_events` / `egress_event_ingest_cursors`: egress guard decisions ingested for /audit
 * - `opencode_config_sync_targets.applied_egress_revision`: egress policy change notifications
 * - Legacy admin regex filter rules are moved into the layered configuration (`message_filters` on the
 *   global layer for global rules, on each workspace layer for workspace-scoped rules), then their tables
 *   (rules, workspace links, manager sync targets) are dropped.
 * - Webhook subscriptions to `filter_rule.triggered` move to `message_filter.triggered`; the removed
 *   `filter_rule.created|updated|deleted` events are unsubscribed (configuration changes now publish
 *   `agent_config.updated`).
 */
export class LayeredSecurityPoliciesAndEgressEvents1792000000000 implements MigrationInterface {
  name = 'LayeredSecurityPoliciesAndEgressEvents1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'statistics_egress_events',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'statistics_agent_id', type: 'uuid', isNullable: true },
          { name: 'statistics_client_id', type: 'uuid', isNullable: false },
          { name: 'source_seq', type: 'bigint', isNullable: false },
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
          { name: 'mode', type: 'varchar', length: '16', isNullable: true },
          { name: 'policy_revision', type: 'varchar', length: '64', isNullable: true },
          { name: 'message', type: 'text', isNullable: true },
          { name: 'first_seen_at', type: 'timestamp', isNullable: false },
          { name: 'occurred_at', type: 'timestamp', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'statistics_egress_events',
      new TableForeignKey({
        columnNames: ['statistics_agent_id'],
        referencedTableName: 'statistics_agents',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_egress_events',
      new TableForeignKey({
        columnNames: ['statistics_client_id'],
        referencedTableName: 'statistics_clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    for (const index of [
      new TableIndex({
        name: 'IDX_statistics_egress_events_client_occurred_at',
        columnNames: ['statistics_client_id', 'occurred_at'],
      }),
      new TableIndex({
        name: 'IDX_statistics_egress_events_agent_occurred_at',
        columnNames: ['statistics_agent_id', 'occurred_at'],
      }),
      new TableIndex({
        name: 'IDX_statistics_egress_events_decision_occurred_at',
        columnNames: ['decision', 'occurred_at'],
      }),
      new TableIndex({
        name: 'UQ_statistics_egress_events_source',
        columnNames: ['statistics_client_id', 'source_seq'],
        isUnique: true,
      }),
    ]) {
      await queryRunner.createIndex('statistics_egress_events', index);
    }

    await queryRunner.createTable(
      new Table({
        name: 'egress_event_ingest_cursors',
        columns: [
          { name: 'client_id', type: 'uuid', isPrimary: true },
          { name: 'last_seq', type: 'bigint', isNullable: false, default: 0 },
          { name: 'last_error', type: 'text', isNullable: true },
          { name: 'last_ingested_at', type: 'timestamp', isNullable: true },
          { name: 'updated_at', type: 'timestamp', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'egress_event_ingest_cursors',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.addColumn(
      'opencode_config_sync_targets',
      new TableColumn({ name: 'applied_egress_revision', type: 'varchar', length: '64', isNullable: true }),
    );

    await this.migrateLegacyFilterRules(queryRunner);

    await queryRunner.query(`
      UPDATE "webhook_endpoints"
      SET "subscribed_events" = COALESCE(
        (
          SELECT jsonb_agg(DISTINCT CASE WHEN value = 'filter_rule.triggered' THEN 'message_filter.triggered' ELSE value END)
          FROM jsonb_array_elements_text("subscribed_events") AS value
          WHERE value NOT IN ('filter_rule.created', 'filter_rule.updated', 'filter_rule.deleted')
        ),
        '[]'::jsonb
      )
      WHERE "subscribed_events" ?| ARRAY['filter_rule.triggered', 'filter_rule.created', 'filter_rule.updated', 'filter_rule.deleted']
    `);

    await queryRunner.query('DROP TABLE IF EXISTS "agent_console_regex_filter_rule_sync_targets"');
    await queryRunner.query('DROP TABLE IF EXISTS "agent_console_regex_filter_rule_clients"');
    await queryRunner.query('DROP TABLE IF EXISTS "agent_console_regex_filter_rules"');
  }

  private async migrateLegacyFilterRules(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('agent_console_regex_filter_rules'))) {
      return;
    }

    const rules = (await queryRunner.query(
      `SELECT "id", "pattern", "regex_flags", "direction", "filter_type", "replace_content", "priority", "enabled", "is_global"
       FROM "agent_console_regex_filter_rules"
       ORDER BY "priority" ASC, "created_at" ASC`,
    )) as LegacyRuleRow[];

    if (rules.length === 0) {
      return;
    }

    const links = (await queryRunner.query(
      'SELECT "rule_id", "client_id" FROM "agent_console_regex_filter_rule_clients"',
    )) as Array<{ rule_id: string; client_id: string }>;
    const globalRules: MessageFilterRule[] = [];
    const byClient = new Map<string, MessageFilterRule[]>();
    const skipped: string[] = [];

    rules.forEach((row, index) => {
      const rule = toMessageFilterRule(row, index);

      if (!rule) {
        skipped.push(`${row.id} (${row.filter_type}, pattern ${JSON.stringify(row.pattern.slice(0, 200))})`);

        return;
      }

      if (row.is_global) {
        globalRules.push(rule);

        return;
      }

      for (const link of links.filter((entry) => entry.rule_id === row.id)) {
        byClient.set(link.client_id, [...(byClient.get(link.client_id) ?? []), rule]);
      }
    });

    if (globalRules.length > 0) {
      const rows = (await queryRunner.query(
        'SELECT "id", "config" FROM "global_opencode_config" ORDER BY "updated_at" DESC LIMIT 1',
      )) as Array<{ id: string; config: unknown }>;

      if (rows[0]) {
        await queryRunner.query(
          'UPDATE "global_opencode_config" SET "config" = $1, "updated_at" = now() WHERE "id" = $2',
          [JSON.stringify(mergeRules(rows[0].config, globalRules)), rows[0].id],
        );
      } else {
        await queryRunner.query('INSERT INTO "global_opencode_config" ("config") VALUES ($1)', [
          JSON.stringify(mergeRules({}, globalRules)),
        ]);
      }
    }

    for (const [clientId, clientRules] of byClient) {
      const rows = (await queryRunner.query(
        'SELECT "id", "config" FROM "client_opencode_config" WHERE "client_id" = $1',
        [clientId],
      )) as Array<{ id: string; config: unknown }>;

      if (rows[0]) {
        await queryRunner.query(
          'UPDATE "client_opencode_config" SET "config" = $1, "updated_at" = now() WHERE "id" = $2',
          [JSON.stringify(mergeRules(rows[0].config, clientRules)), rows[0].id],
        );
      } else {
        await queryRunner.query('INSERT INTO "client_opencode_config" ("client_id", "config") VALUES ($1, $2)', [
          clientId,
          JSON.stringify(mergeRules({}, clientRules)),
        ]);
      }
    }

    // eslint-disable-next-line no-console
    console.warn(
      '[migration] Legacy filter rules moved to the layered "Message filters" configuration. Semantics changed: ' +
        'the most restrictive outcome now wins (drop > replace > flag) instead of the first matching rule by priority.',
    );

    if (skipped.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[migration] ${skipped.length} legacy filter rule(s) were not migrated (invalid regex, unsupported flags or ` +
          `catastrophic-backtracking risk); recreate them manually if still needed:\n  ${skipped.join('\n  ')}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Message filters stay in the layered configuration; only the (empty) legacy tables are restored.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_console_regex_filter_rules" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "pattern" text NOT NULL,
        "regex_flags" varchar(16) NOT NULL DEFAULT 'g',
        "direction" varchar(32) NOT NULL,
        "filter_type" varchar(16) NOT NULL,
        "replace_content" text NULL,
        "priority" int NOT NULL DEFAULT 0,
        "enabled" boolean NOT NULL DEFAULT true,
        "is_global" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_console_regex_filter_rule_clients" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "rule_id" uuid NOT NULL REFERENCES "agent_console_regex_filter_rules"("id") ON DELETE CASCADE,
        "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_console_regex_rule_client" UNIQUE ("rule_id", "client_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_console_regex_filter_rule_sync_targets" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "rule_id" uuid NOT NULL REFERENCES "agent_console_regex_filter_rules"("id") ON DELETE CASCADE,
        "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
        "manager_rule_id" uuid NULL,
        "desired_on_manager" boolean NOT NULL DEFAULT true,
        "sync_status" varchar(16) NOT NULL DEFAULT 'pending',
        "last_error" text NULL,
        "last_synced_at" timestamp NULL,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "UQ_console_regex_sync_rule_client" UNIQUE ("rule_id", "client_id")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_console_regex_sync_status" ON "agent_console_regex_filter_rule_sync_targets" ("sync_status", "desired_on_manager")',
    );
    await queryRunner.query(`
      UPDATE "webhook_endpoints"
      SET "subscribed_events" = (
        SELECT jsonb_agg(CASE WHEN value = 'message_filter.triggered' THEN 'filter_rule.triggered' ELSE value END)
        FROM jsonb_array_elements_text("subscribed_events") AS value
      )
      WHERE "subscribed_events" ? 'message_filter.triggered'
    `);
    await queryRunner.dropColumn('opencode_config_sync_targets', 'applied_egress_revision');
    await queryRunner.dropTable('egress_event_ingest_cursors', true, true, true);
    await queryRunner.dropTable('statistics_egress_events', true, true, true);
  }
}
