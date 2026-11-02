import type { SqlClient } from './database-target.boot';
import {
  createSlotWithSnapshot,
  createSubscription,
  dropSubscription,
  ensurePublication,
  externalCopyStatus,
  holdsSlot,
} from './external-copy';

function fake(responses: [RegExp, unknown[]][] = [], fail?: RegExp): SqlClient & { sql: string[] } {
  const sql: string[] = [];

  return {
    sql,
    query: async (text: string) => {
      const flat = text.replace(/\s+/g, ' ').trim();

      if (fail?.test(flat)) throw new Error('could not connect to the publisher');

      sql.push(flat);

      return { rows: (responses.find(([re]) => re.test(flat))?.[1] ?? []) as never[] };
    },
  };
}

const tables: [RegExp, unknown[]] = [
  /AS pk/,
  [
    { name: 'lw_nodes', pk: true },
    { name: 'migrations', pk: true },
    { name: 'lw_no_pk', pk: false },
  ],
];

describe('external copy (3.43)', () => {
  it('creates the publication over tables with a primary key, then keeps its list in line', async () => {
    const fresh = fake([tables]);

    expect(await ensurePublication(fresh)).toEqual({ published: ['lw_nodes'], skipped: ['lw_no_pk'] });
    expect(fresh.sql.at(-1)).toBe('CREATE PUBLICATION "lw_external_copy" FOR TABLE "lw_nodes"');

    const existing = fake([tables, [/FROM pg_publication WHERE/, [{ '?column?': 1 }]]]);

    await ensurePublication(existing);
    expect(existing.sql.at(-1)).toBe('ALTER PUBLICATION "lw_external_copy" SET TABLE "lw_nodes"');
  });

  it('creates the subscription disabled, empties the tables only for a copy, then enables it', async () => {
    const external = fake();

    await createSubscription(external, "host='10.93.0.1'", { copyData: true, slot: 's1', tables: ['lw_nodes'] });
    expect(external.sql[0]).toMatch(
      /^CREATE SUBSCRIPTION "lw_external_copy" CONNECTION 'host=''10\.93\.0\.1''' PUBLICATION "lw_external_copy" WITH \(enabled = false, copy_data = true, create_slot = true, slot_name = 's1'\)$/,
    );
    expect(external.sql.slice(1)).toEqual(['TRUNCATE "lw_nodes"', 'ALTER SUBSCRIPTION "lw_external_copy" ENABLE']);

    const handover = fake();

    await createSubscription(handover, 'x', { copyData: false, slot: 's2', tables: ['lw_nodes'] });
    expect(handover.sql.some((s) => s.startsWith('TRUNCATE'))).toBe(false);
  });

  it('never empties the external copy when the subscription cannot be created', async () => {
    const external = fake([], /^CREATE SUBSCRIPTION/);

    await expect(
      createSubscription(external, 'x', { copyData: true, slot: 's', tables: ['lw_nodes'] }),
    ).rejects.toThrow(/publisher/);
    expect(external.sql).toEqual([]);
  });

  it('drops the subscription without contacting the members', async () => {
    const none = fake();

    expect(await dropSubscription(none)).toBeNull();

    const external = fake([[/subslotname AS slot/, [{ slot: 'lw_external_copy_abc' }]]]);

    expect(await dropSubscription(external)).toBe('lw_external_copy_abc');
    expect(external.sql.slice(1)).toEqual([
      'ALTER SUBSCRIPTION "lw_external_copy" DISABLE',
      'ALTER SUBSCRIPTION "lw_external_copy" SET (slot_name = NONE)',
      'DROP SUBSCRIPTION "lw_external_copy"',
    ]);
  });

  it('reports pending migrations, missing slot, unsubscribed tables and a stopped worker', async () => {
    const members = fake([
      [/FROM migrations/, [{ name: 'A1' }, { name: 'B2' }]],
      [/pg_publication_tables/, [{ name: 'lw_nodes' }, { name: 'lw_new' }]],
    ]);
    const external = fake([
      [/FROM migrations/, [{ name: 'A1' }]],
      [/s.subenabled AS enabled/, [{ oid: 7, slot: 'old', enabled: true }]],
      [/pg_subscription_rel/, [{ name: 'lw_nodes', state: 'd' }]],
    ]);

    expect(await externalCopyStatus(members, external)).toEqual({
      subscription: true,
      slotOnPrimary: false,
      pendingMigrations: 1,
      unsubscribedTables: 1,
      failing: true,
      slot: 'old',
      published: ['lw_nodes', 'lw_new'],
      enabled: true,
      tablesNotReady: 1,
    });
  });

  it('creates the subscription on an existing slot without a copy (the re-copy made the data)', async () => {
    const external = fake();

    await createSubscription(external, 'x', { copyData: false, createSlot: false, slot: 's3', tables: ['lw_nodes'] });
    expect(external.sql[0]).toMatch(
      /WITH \(enabled = false, copy_data = false, create_slot = false, slot_name = 's3'\)$/,
    );
    expect(external.sql.some((s) => s.startsWith('TRUNCATE'))).toBe(false);
  });

  it("creates the re-copy's slot with an exported snapshot", async () => {
    const replication = fake([
      [
        /^CREATE_REPLICATION_SLOT/,
        [{ slot_name: 's4', consistent_point: '0/16B6C50', snapshot_name: '00000003-1', output_plugin: 'pgoutput' }],
      ],
    ]);

    expect(await createSlotWithSnapshot(replication, 'lw_external_copy_abc')).toEqual({
      snapshot: '00000003-1',
      consistentPoint: '0/16B6C50',
    });
    expect(replication.sql).toEqual([
      `CREATE_REPLICATION_SLOT "lw_external_copy_abc" LOGICAL pgoutput (SNAPSHOT 'export')`,
    ]);
    await expect(createSlotWithSnapshot(fake(), 's')).rejects.toThrow(/no snapshot/);
  });

  it('tells whether a member holds the slot', async () => {
    expect(await holdsSlot(fake([[/pg_replication_slots/, [{ '?column?': 1 }]]]), 's')).toBe(true);
    expect(await holdsSlot(fake(), 's')).toBe(false);
  });
});
