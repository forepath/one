import type { SqlClient } from './database-target.boot';
import {
  NOT_COPIED_TABLES,
  quoteIdent,
  quoteLiteral,
  rowCountMismatches,
  schemaMismatches,
  type TableInfo,
} from './database-handover.utils';

/** Rows per batch of the copy (JSON through one parameter; the control plane's rows are small). */
export const COPY_BATCH_ROWS = 500;

/** Base tables of `public` (no partitions) with their columns in order; `generated`: columns that can't be inserted. */
export async function tableColumns(
  client: SqlClient,
): Promise<Record<string, { columns: string[]; generated: string[] }>> {
  const { rows } = await client.query<{ table: string; column: string; generated: string }>(
    `SELECT c.relname AS "table", a.attname AS "column", a.attgenerated AS "generated"
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      ORDER BY c.relname, a.attnum`,
  );
  const tables: Record<string, { columns: string[]; generated: string[] }> = {};

  for (const row of rows) {
    const t = (tables[row.table] ??= { columns: [], generated: [] });

    t.columns.push(row.column);

    if (row.generated) t.generated.push(row.column);
  }

  return tables;
}

/** Tables with primary key / hypertable flags (for the publication). */
export async function tableInfos(client: SqlClient): Promise<TableInfo[]> {
  const { rows: hyper } = await client
    .query<{
      name: string;
    }>(`SELECT hypertable_name AS name FROM timescaledb_information.hypertables WHERE hypertable_schema = 'public'`)
    .catch(() => ({ rows: [] as { name: string }[] }));
  const hypertables = new Set(hyper.map((h) => h.name));
  const { rows } = await client.query<{ name: string; pk: boolean }>(
    `SELECT c.relname AS name, EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary) AS pk
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relispartition`,
  );

  return rows.map((r) => ({ name: r.name, primaryKey: !!r.pk, hypertable: hypertables.has(r.name) }));
}

export async function rowCounts(client: SqlClient, tables: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const table of tables) {
    const { rows } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${quoteIdent(table)}`);

    counts[table] = Number(rows[0]?.n ?? 0);
  }

  return counts;
}

export interface CopyResult {
  tables: number;
  rows: number;
  sequences: number;
  counts: Record<string, number>;
}

/**
 * Copies the data of every table of `public` (except the migration bookkeeping) from `source` to `target` in one
 * consistent snapshot, then the sequences, and verifies the row counts. The target's schema must exist (the same
 * migrations); a column only the source has refuses the copy. `target` runs as the members' superuser:
 * `session_replication_role = replica` skips foreign-key checks and triggers while loading in any order.
 *
 * Rows travel as JSON (`row_to_json` → `json_populate_recordset`), which round-trips every type through its text form
 * (bytea, arrays, jsonb, timestamps, enums) without `pg_dump` in the image.
 */
export interface CopyOptions {
  /** Import this exported snapshot on `source` (the re-copy's slot: the subscription continues exactly after it). */
  snapshot?: string;
  /** Copy only these tables (the published ones for the external copy). */
  tables?: readonly string[];
  /**
   * Replace the target's rows with `DELETE` instead of `TRUNCATE` (3.43 re-copy): readers of the target keep seeing the
   * previous rows (MVCC) until the copy commits, instead of waiting on TRUNCATE's exclusive lock.
   */
  keepReadable?: boolean;
}

export async function copyDatabase(
  source: SqlClient,
  target: SqlClient,
  options: CopyOptions = {},
): Promise<CopyResult> {
  const sourceTables = await tableColumns(source);
  const targetTables = await tableColumns(target);
  const only = options.tables ? new Set(options.tables) : null;
  const tables = Object.keys(sourceTables)
    .filter((t) => !NOT_COPIED_TABLES.has(t) && (!only || only.has(t)))
    .sort();
  const problems = schemaMismatches(
    Object.fromEntries(tables.map((t) => [t, sourceTables[t].columns])),
    Object.fromEntries(Object.entries(targetTables).map(([t, v]) => [t, v.columns])),
  );

  if (problems.length) throw new Error(`schema differs: ${problems.join('; ')}`);

  let total = 0;

  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

  try {
    if (options.snapshot) await source.query(`SET TRANSACTION SNAPSHOT ${quoteLiteral(options.snapshot)}`);

    await target.query('BEGIN');
    await target.query('SET LOCAL session_replication_role = replica');

    if (options.keepReadable) for (const table of tables) await target.query(`DELETE FROM ${quoteIdent(table)}`);
    else if (tables.length) await target.query(`TRUNCATE ${tables.map(quoteIdent).join(', ')}`);

    for (const table of tables) {
      const columns = sourceTables[table].columns.filter((c) => !targetTables[table].generated.includes(c));
      const list = columns.map(quoteIdent).join(', ');

      await source.query(
        `DECLARE lw_copy NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS r FROM ${quoteIdent(table)} t`,
      );

      for (;;) {
        const { rows } = await source.query<{ r: string }>(`FETCH ${COPY_BATCH_ROWS} FROM lw_copy`);

        if (rows.length === 0) break;

        await target.query(
          `INSERT INTO ${quoteIdent(table)} (${list}) OVERRIDING SYSTEM VALUE
             SELECT ${list} FROM json_populate_recordset(NULL::${quoteIdent(table)}, $1::json)`,
          [`[${rows.map((r) => r.r).join(',')}]`],
        );
        total += rows.length;
      }

      await source.query('CLOSE lw_copy');
    }

    const sequences = await copySequences(source, target);
    const sourceCounts = await rowCounts(source, tables);
    const targetCounts = await rowCounts(target, tables);
    const mismatches = rowCountMismatches(sourceCounts, targetCounts);

    if (mismatches.length) throw new Error(`row counts differ after the copy: ${mismatches.join('; ')}`);

    await target.query('COMMIT');

    return { tables: tables.length, rows: total, sequences, counts: sourceCounts };
  } catch (error) {
    await target.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await source.query('ROLLBACK').catch(() => undefined);
  }
}

async function copySequences(source: SqlClient, target: SqlClient): Promise<number> {
  const { rows } = await source.query<{ name: string; last: string | null }>(
    `SELECT sequencename AS name, last_value::text AS last FROM pg_sequences WHERE schemaname = 'public'`,
  );

  for (const row of rows) {
    if (row.last === null) continue;

    await target.query(`SELECT setval($1::regclass, $2::bigint, true)`, [quoteIdent(row.name), row.last]);
  }

  return rows.length;
}
