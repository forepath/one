import type { SqlClient } from './database-target.boot';
import {
  EXTERNAL_COPY_SUBSCRIPTION,
  quoteIdent,
  type ExternalCopyReadiness,
  type HandoverRowState,
  type MemberDataState,
} from './database-handover.utils';

/**
 * SQL of the fenced takeover (3.43, user decision 2026-10-31): the external copy's readiness, the sequences it needs
 * before taking writes, the epoch found in a member primary's data, and the database-level fence of a member primary
 * whose data belongs to an older epoch.
 */

/** What the external database says about itself as a copy (subscription, table states, the replicated row). */
export async function copyReadiness(external: SqlClient): Promise<ExternalCopyReadiness> {
  const { rows: subs } = await external.query<{ oid: number }>(
    `SELECT s.oid FROM pg_subscription s JOIN pg_database d ON d.oid = s.subdbid
      WHERE s.subname = $1 AND d.datname = current_database()`,
    [EXTERNAL_COPY_SUBSCRIPTION],
  );
  const sub = subs[0];
  const { rows: notReady } = sub
    ? await external.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_subscription_rel WHERE srsubid = $1 AND srsubstate <> 'r'`,
        [sub.oid],
      )
    : { rows: [] as { n: string }[] };
  const { rows } = await external
    .query<{
      state: HandoverRowState;
      external_copy: { state?: unknown; checkedAt?: unknown; completeAt?: unknown } | null;
      epoch: string | null;
    }>(
      `SELECT h."state", h."external_copy", to_jsonb(h)->>'epoch' AS epoch FROM "lw_database_handover" h
        WHERE h."id" = 'cluster'`,
    )
    .catch(() => ({ rows: [] as { state: HandoverRowState; external_copy: null; epoch: null }[] }));
  const copy = rows[0]?.external_copy ?? null;

  return {
    subscription: !!sub,
    tablesNotReady: Number(notReady[0]?.n ?? 0),
    rowState: rows[0]?.state ?? null,
    copyState: typeof copy?.state === 'string' ? copy.state : null,
    copyCheckedAt: typeof copy?.checkedAt === 'string' ? copy.checkedAt : null,
    copyCompleteAt: typeof copy?.completeAt === 'string' ? copy.completeAt : null,
    rowEpoch: rows[0]?.epoch ? Number(rows[0].epoch) : null,
  };
}

/**
 * Logical replication doesn't carry sequences: the copy's sequences are where the handover left them, behind the
 * replicated rows. Before the copy takes writes, every sequence owned by a column moves past that column's maximum
 * (never backwards). Returns how many were checked.
 */
export async function advanceSequences(client: SqlClient): Promise<number> {
  const { rows } = await client.query<{ seq: string; tbl: string; col: string }>(
    `SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
       FROM pg_class s
       JOIN pg_namespace n ON n.oid = s.relnamespace
       JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
       JOIN pg_class t ON t.oid = d.refobjid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      WHERE s.relkind = 'S' AND n.nspname = 'public'
      ORDER BY s.relname`,
  );

  for (const row of rows) {
    const seq = quoteIdent(row.seq);

    await client.query(
      `SELECT setval($1::regclass, GREATEST((SELECT last_value FROM ${seq}), (SELECT COALESCE(max(${quoteIdent(row.col)}), 0) FROM ${quoteIdent(row.tbl)}), 1), true)`,
      [seq],
    );
  }

  return rows.length;
}

/**
 * The epoch of a member primary's data: `admin` is a session on its `postgres` database, `connect` opens one on
 * `database`. No database: nothing to fence (a fresh member); a row without the epoch column (before the takeover
 * existed) counts as epoch 0.
 */
export async function memberDataState(
  admin: SqlClient,
  database: string,
  connect: () => Promise<SqlClient & { end(): Promise<void> }>,
): Promise<MemberDataState> {
  const { rows } = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [database]);

  if (!rows.length) return { database: false, state: null, epoch: null };

  const client = await connect();

  try {
    const { rows: found } = await client
      .query<{ state: string; epoch: number | string | null }>(
        `SELECT to_jsonb(h)->>'state' AS state, COALESCE((to_jsonb(h)->>'epoch')::int, 0) AS epoch
           FROM "lw_database_handover" h WHERE h."id" = 'cluster'`,
      )
      .catch(() => ({ rows: [] as { state: string; epoch: number | null }[] }));

    return {
      database: true,
      state: found[0]?.state ?? null,
      epoch: found[0] ? Number(found[0].epoch ?? 0) : null,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Custom database settings a fenced member's agent reads from its own catalog (replicated to its replicas too). */
export const FENCE_SETTINGS = {
  epoch: 'loadweaver.fenced_epoch',
  takenOverAt: 'loadweaver.fenced_at',
  scope: 'loadweaver.fenced_scope',
} as const;

/**
 * Fences a member primary whose data belongs to an older epoch, at the database level (`admin`: superuser session on
 * its `postgres` database): the fence settings tell its agent (which moves the data aside), the database turns
 * read-only and its client sessions are cut, so a member API replica on the old data can't write any more. Nothing is
 * dropped: the agent exports the rows written there after the takeover first.
 */
export async function fenceMemberDatabase(
  admin: SqlClient,
  database: string,
  fence: { epoch: number; takenOverAt: string; scope: string | null },
): Promise<void> {
  const db = quoteIdent(database);
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

  await admin.query('SET default_transaction_read_only = off');
  await admin.query(`ALTER DATABASE ${db} SET ${FENCE_SETTINGS.epoch} = ${literal(String(fence.epoch))}`);
  await admin.query(`ALTER DATABASE ${db} SET ${FENCE_SETTINGS.takenOverAt} = ${literal(fence.takenOverAt)}`);

  if (fence.scope) await admin.query(`ALTER DATABASE ${db} SET ${FENCE_SETTINGS.scope} = ${literal(fence.scope)}`);

  await admin.query(`ALTER DATABASE ${db} SET default_transaction_read_only = on`);
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid() AND backend_type = 'client backend'`,
    [database],
  );
}
