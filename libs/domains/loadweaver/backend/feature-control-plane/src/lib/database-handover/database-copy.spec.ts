import { COPY_BATCH_ROWS, copyDatabase } from './database-copy';
import type { SqlClient } from './database-target.boot';

type Columns = Record<string, string[]>;

/** A fake Postgres: tables with columns and JSON rows; records the statements. */
function fakeDb(columns: Columns, rows: Record<string, string[]> = {}, sequences: Record<string, string> = {}) {
  const sql: string[] = [];
  const inserted: Record<string, number> = {};
  let cursor: { table: string; offset: number } | null = null;
  const client: SqlClient = {
    query: async (text: string, params?: unknown[]) => {
      sql.push(text.replace(/\s+/g, ' ').trim());

      if (text.includes('FROM pg_class c') && text.includes('pg_attribute'))
        return {
          rows: Object.entries(columns).flatMap(([table, cols]) =>
            cols.map((column) => ({ table, column, generated: column === 'gen' ? 's' : '' })),
          ),
        } as never;

      const declare = /DECLARE lw_copy .* FROM "([^"]+)" t/.exec(text);

      if (declare) cursor = { table: declare[1], offset: 0 };

      if (text.startsWith('FETCH') && cursor) {
        const all = rows[cursor.table] ?? [];
        const batch = all.slice(cursor.offset, cursor.offset + COPY_BATCH_ROWS);

        cursor.offset += batch.length;

        return { rows: batch.map((r) => ({ r })) } as never;
      }

      const insert = /INSERT INTO "([^"]+)"/.exec(text);

      if (insert) inserted[insert[1]] = (inserted[insert[1]] ?? 0) + (JSON.parse(params?.[0] as string) as []).length;

      if (text.includes('FROM pg_sequences'))
        return { rows: Object.entries(sequences).map(([name, last]) => ({ name, last })) } as never;

      const count = /SELECT count\(\*\)::text AS n FROM "([^"]+)"/.exec(text);

      if (count) return { rows: [{ n: String(rows[count[1]]?.length ?? inserted[count[1]] ?? 0) }] } as never;

      return { rows: [] } as never;
    },
  };

  return { client, sql, inserted };
}

describe('copyDatabase (3.43 handover copy)', () => {
  const columns: Columns = { lw_nodes: ['name', 'site'], lw_audit_events: ['seq', 'gen'], migrations: ['id', 'name'] };

  it('copies every table but the migration bookkeeping in one snapshot, in batches, with sequences and counts', async () => {
    const nodes = Array.from({ length: COPY_BATCH_ROWS + 1 }, (_, i) => JSON.stringify({ name: `n${i}`, site: 's' }));
    const source = fakeDb(columns, { lw_nodes: nodes, lw_audit_events: ['{"seq":"1","gen":"x"}'] }, { seq_a: '42' });
    const target = fakeDb(columns);

    const result = await copyDatabase(source.client, target.client);

    expect(result).toEqual({
      tables: 2,
      rows: COPY_BATCH_ROWS + 2,
      sequences: 1,
      counts: { lw_audit_events: 1, lw_nodes: COPY_BATCH_ROWS + 1 },
    });
    expect(source.sql[1]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(target.sql).toContain('SET LOCAL session_replication_role = replica');
    expect(target.sql).toContain('TRUNCATE "lw_audit_events", "lw_nodes"');
    expect(target.inserted).toEqual({ lw_nodes: COPY_BATCH_ROWS + 1, lw_audit_events: 1 });
    // Generated columns are left to the target.
    expect(target.sql.find((s) => s.startsWith('INSERT INTO "lw_audit_events"'))).toContain('("seq")');
    expect(target.sql.some((s) => s.includes('setval'))).toBe(true);
    expect(target.sql.at(-1)).toBe('COMMIT');
    expect(target.sql.some((s) => s.includes('"migrations"'))).toBe(false);
  });

  it('refuses a source schema the members do not have (no silent data loss)', async () => {
    const source = fakeDb({ lw_nodes: ['name', 'extra'] });
    const target = fakeDb({ lw_nodes: ['name'] });

    await expect(copyDatabase(source.client, target.client)).rejects.toThrow(/columns extra are missing/);
    expect(target.sql.some((s) => s.startsWith('INSERT'))).toBe(false);
  });

  it('rolls back when the counts differ after the copy', async () => {
    const source = fakeDb({ lw_nodes: ['name'] }, { lw_nodes: ['{"name":"a"}'] });
    const target = fakeDb({ lw_nodes: ['name'] });
    const query = target.client.query.bind(target.client);

    target.client.query = (async (text: string, params?: unknown[]) =>
      text.startsWith('SELECT count(*)') ? { rows: [{ n: '0' }] } : await query(text, params)) as never;

    await expect(copyDatabase(source.client, target.client)).rejects.toThrow(/row counts differ.*lw_nodes: 1 → 0/);
    expect(target.sql.at(-1)).toBe('ROLLBACK');
  });

  it('re-copy (3.43): imports the slot snapshot, copies only the given tables and keeps old rows readable until commit', async () => {
    const source = fakeDb(columns, { lw_nodes: ['{"name":"a","site":"s"}'], lw_audit_events: ['{"seq":"1"}'] });
    const target = fakeDb(columns);

    const result = await copyDatabase(source.client, target.client, {
      snapshot: '00000003-1',
      tables: ['lw_nodes'],
      keepReadable: true,
    });

    expect(result.tables).toBe(1);
    expect(source.sql.slice(1, 3)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      "SET TRANSACTION SNAPSHOT '00000003-1'",
    ]);
    expect(target.sql).toContain('DELETE FROM "lw_nodes"');
    expect(target.sql.some((s) => s.startsWith('TRUNCATE'))).toBe(false);
    expect(target.sql.some((s) => s.includes('"lw_audit_events"'))).toBe(false);
    expect(target.sql.at(-1)).toBe('COMMIT');
  });
});
