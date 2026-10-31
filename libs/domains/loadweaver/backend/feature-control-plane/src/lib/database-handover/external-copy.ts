import { tableInfos } from './database-copy';
import type { SqlClient } from './database-target.boot';
import {
  EXTERNAL_COPY_PUBLICATION,
  EXTERNAL_COPY_SUBSCRIPTION,
  pendingMigrationNames,
  publishableTables,
  quoteIdent,
  quoteLiteral,
  type ExternalCopyStatus,
} from './database-handover.utils';

/**
 * The external copy (3.43): the external database follows the members' database as a logical-replication subscriber.
 * The publication lives on the members' database (tables with a primary key, no hypertables, no migration
 * bookkeeping); the subscription on the external database connects to every member (`target_session_attrs=read-write`).
 */

/** Creates or updates the publication's table list on the members' database. */
export async function ensurePublication(members: SqlClient): Promise<{ published: string[]; skipped: string[] }> {
  const tables = publishableTables(await tableInfos(members));
  const list = tables.published.map(quoteIdent).join(', ');
  const { rows } = await members.query(`SELECT 1 FROM pg_publication WHERE pubname = $1`, [EXTERNAL_COPY_PUBLICATION]);

  if (tables.published.length === 0) return tables;

  await members.query(
    rows.length
      ? `ALTER PUBLICATION ${quoteIdent(EXTERNAL_COPY_PUBLICATION)} SET TABLE ${list}`
      : `CREATE PUBLICATION ${quoteIdent(EXTERNAL_COPY_PUBLICATION)} FOR TABLE ${list}`,
  );

  return tables;
}

export async function walLevel(members: SqlClient): Promise<string> {
  const { rows } = await members.query<{ wal_level: string }>('SHOW wal_level');

  return rows[0]?.wal_level ?? 'unknown';
}

/**
 * Drops the subscription without touching the members (`slot_name = NONE`: works while they are unreachable); the
 * slot on the members, if any, is dropped separately (`dropSlot`).
 */
export async function dropSubscription(external: SqlClient): Promise<string | null> {
  const { rows } = await external.query<{ slot: string | null }>(
    `SELECT subslotname AS slot FROM pg_subscription s JOIN pg_database d ON d.oid = s.subdbid
      WHERE s.subname = $1 AND d.datname = current_database()`,
    [EXTERNAL_COPY_SUBSCRIPTION],
  );

  if (!rows.length) return null;

  const name = quoteIdent(EXTERNAL_COPY_SUBSCRIPTION);

  await external.query(`ALTER SUBSCRIPTION ${name} DISABLE`);
  await external.query(`ALTER SUBSCRIPTION ${name} SET (slot_name = NONE)`);
  await external.query(`DROP SUBSCRIPTION ${name}`);

  return rows[0].slot;
}

/** Drops an inactive replication slot on the members' primary (best effort for the caller). */
export async function dropSlot(members: SqlClient, slot: string): Promise<void> {
  await members.query(
    `SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name = $1 AND NOT active`,
    [slot],
  );
}

/**
 * Creates the subscription. `copyData = false` only right after a handover (both sides hold the same frozen data);
 * otherwise the external tables are emptied and the subscription copies them from the members. Created disabled first:
 * when the external server can't reach the members, the statement fails before anything was emptied.
 */
export async function createSubscription(
  external: SqlClient,
  conninfo: string,
  options: { copyData: boolean; slot: string; tables: readonly string[]; createSlot?: boolean },
): Promise<void> {
  const name = quoteIdent(EXTERNAL_COPY_SUBSCRIPTION);

  await external.query(
    `CREATE SUBSCRIPTION ${name} CONNECTION ${quoteLiteral(conninfo)}
       PUBLICATION ${quoteIdent(EXTERNAL_COPY_PUBLICATION)}
       WITH (enabled = false, copy_data = ${options.copyData}, create_slot = ${options.createSlot ?? true}, slot_name = ${quoteLiteral(options.slot)})`,
  );

  if (options.copyData && options.tables.length)
    await external.query(`TRUNCATE ${options.tables.map(quoteIdent).join(', ')}`);

  await external.query(`ALTER SUBSCRIPTION ${name} ENABLE`);
}

/** Stops the apply worker; the external tables keep their data (a re-copy builds the next copy meanwhile). */
export async function disableSubscription(external: SqlClient): Promise<void> {
  await external.query(`ALTER SUBSCRIPTION ${quoteIdent(EXTERNAL_COPY_SUBSCRIPTION)} DISABLE`);
}

export async function enableSubscription(external: SqlClient): Promise<void> {
  await external.query(`ALTER SUBSCRIPTION ${quoteIdent(EXTERNAL_COPY_SUBSCRIPTION)} ENABLE`);
}

/**
 * Creates the re-copy's slot over a replication connection (`replication=database`) and exports its snapshot: a copy
 * that imports it (`SET TRANSACTION SNAPSHOT`) sees exactly the data before the slot's first change, so the
 * subscription that then streams from the slot (`copy_data = false`) neither misses nor repeats anything. The snapshot
 * stays valid while `replication` is open and idle.
 */
export async function createSlotWithSnapshot(
  replication: SqlClient,
  slot: string,
): Promise<{ snapshot: string; consistentPoint: string }> {
  const { rows } = await replication.query<{ snapshot_name: string | null; consistent_point: string }>(
    `CREATE_REPLICATION_SLOT ${quoteIdent(slot)} LOGICAL pgoutput (SNAPSHOT 'export')`,
  );
  const snapshot = rows[0]?.snapshot_name;

  if (!snapshot) throw new Error(`the replication slot ${slot} exported no snapshot`);

  return { snapshot, consistentPoint: rows[0].consistent_point };
}

/** Whether a member (primary or replica) holds the slot (a replica's copy is Patroni's permanent logical slot). */
export async function holdsSlot(client: SqlClient, slot: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT 1 FROM pg_replication_slots WHERE slot_name = $1`, [slot]);

  return rows.length > 0;
}

/** Fetches the publication's new tables (after the external copy ran the same migrations). */
export async function refreshSubscription(external: SqlClient): Promise<void> {
  await external.query(
    `ALTER SUBSCRIPTION ${quoteIdent(EXTERNAL_COPY_SUBSCRIPTION)} REFRESH PUBLICATION WITH (copy_data = true)`,
  );
}

export async function migrationNames(client: SqlClient): Promise<string[]> {
  const { rows } = await client
    .query<{ name: string }>(`SELECT name FROM migrations ORDER BY id`)
    .catch(() => ({ rows: [] as { name: string }[] }));

  return rows.map((r) => r.name);
}

/** What the external copy looks like now; `failing`: the apply worker isn't running although enabled. */
export async function externalCopyStatus(
  members: SqlClient,
  external: SqlClient,
): Promise<
  Omit<ExternalCopyStatus, 'failingForMs'> & {
    failing: boolean;
    slot: string | null;
    published: string[];
    enabled: boolean;
    tablesNotReady: number;
  }
> {
  const { rows: subs } = await external.query<{ oid: number; slot: string | null; enabled: boolean }>(
    `SELECT s.oid, s.subslotname AS slot, s.subenabled AS enabled FROM pg_subscription s
       JOIN pg_database d ON d.oid = s.subdbid WHERE s.subname = $1 AND d.datname = current_database()`,
    [EXTERNAL_COPY_SUBSCRIPTION],
  );
  const pendingMigrations = pendingMigrationNames(await migrationNames(members), await migrationNames(external)).length;
  const { rows: pubTables } = await members.query<{ name: string }>(
    `SELECT tablename AS name FROM pg_publication_tables WHERE pubname = $1`,
    [EXTERNAL_COPY_PUBLICATION],
  );
  const published = pubTables.map((t) => t.name);
  const sub = subs[0];

  if (!sub)
    return {
      subscription: false,
      slotOnPrimary: false,
      pendingMigrations,
      unsubscribedTables: published.length,
      failing: false,
      slot: null,
      published,
      enabled: false,
      tablesNotReady: 0,
    };

  const { rows: slots } = sub.slot
    ? await members.query(`SELECT 1 FROM pg_replication_slots WHERE slot_name = $1`, [sub.slot])
    : { rows: [] };
  const { rows: subscribed } = await external.query<{ name: string; state: string }>(
    `SELECT c.relname AS name, r.srsubstate AS state FROM pg_subscription_rel r JOIN pg_class c ON c.oid = r.srrelid
      WHERE r.srsubid = $1`,
    [sub.oid],
  );
  const { rows: workers } = await external.query(
    `SELECT 1 FROM pg_stat_subscription WHERE subid = $1 AND pid IS NOT NULL`,
    [sub.oid],
  );
  const have = new Set(subscribed.map((t) => t.name));

  return {
    subscription: true,
    slotOnPrimary: slots.length > 0,
    pendingMigrations,
    unsubscribedTables: published.filter((t) => !have.has(t)).length,
    failing: sub.enabled && workers.length === 0,
    slot: sub.slot,
    published,
    enabled: sub.enabled,
    tablesNotReady: subscribed.filter((t) => t.state !== 'r').length,
  };
}
