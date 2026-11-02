import { newerPostgresScope, takeoverPostgresScopeOf } from '../backups/platform/platform-dr.utils';
import { recordDatabaseFence, resetRecordedFences } from './database-fence-record';
import {
  databaseFenceInfo,
  DEFAULT_TAKEOVER_AFTER_MS,
  externalCopyUnusable,
  FALLBACK_AFTER_MS,
  formatBytes,
  memberDataFenced,
  parseDatabaseTargetFile,
  parseFenceRecords,
  takeoverAfterMs,
  takeoverMaxLagMs,
  takeoverPostgresScope,
  takeoverTiming,
  withFenceRecord,
  type DatabaseFenceRecord,
  type ExternalCopyReadiness,
} from './database-handover.utils';
import { databaseInboxItems, FENCE_INBOX_MS } from './database-inbox';
import { advanceSequences, copyReadiness, fenceMemberDatabase, memberDataState } from './database-takeover';

function fakeClient(responses: [RegExp, unknown[]][] = []) {
  const sql: { text: string; params?: unknown[] }[] = [];

  return {
    sql,
    query: jest.fn(async (text: string, params?: unknown[]) => {
      sql.push({ text: text.replace(/\s+/g, ' ').trim(), params });

      return { rows: (responses.find(([re]) => re.test(text))?.[1] ?? []) as never[] };
    }),
    end: jest.fn(async () => undefined),
  };
}

describe('takeover timing (3.43, 2026-10-31)', () => {
  it('reads the delay: default 2 min, off, never below the fallback', () => {
    expect(takeoverAfterMs({})).toBe(DEFAULT_TAKEOVER_AFTER_MS);
    expect(takeoverAfterMs({ LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS: '0' })).toBeNull();
    expect(takeoverAfterMs({ LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS: 'off' })).toBeNull();
    expect(takeoverAfterMs({ LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS: '300000' })).toBe(300_000);
    expect(takeoverAfterMs({ LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS: '1000' })).toBe(FALLBACK_AFTER_MS);
    expect(takeoverAfterMs({ LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS: 'soon' })).toBe(DEFAULT_TAKEOVER_AFTER_MS);
    expect(takeoverMaxLagMs({})).toBe(5 * 60_000);
    expect(takeoverMaxLagMs({ LOADWEAVER_DATABASE_TAKEOVER_MAX_LAG_MS: '60000' })).toBe(60_000);
  });

  it('is due only on the members target, in the fallback, after the delay', () => {
    const base = { target: 'members' as const, fallback: true, noPrimarySince: 0, now: 0, afterMs: 120_000 };

    expect(takeoverTiming({ ...base, target: 'external' })).toEqual({ kind: 'none' });
    expect(takeoverTiming({ ...base, fallback: false })).toEqual({ kind: 'none' });
    expect(takeoverTiming({ ...base, noPrimarySince: null })).toEqual({ kind: 'none' });
    expect(takeoverTiming({ ...base, afterMs: null })).toEqual({ kind: 'off' });
    expect(takeoverTiming({ ...base, now: 100_000 })).toEqual({ kind: 'wait', remainingMs: 20_000 });
    expect(takeoverTiming({ ...base, now: 120_000 })).toEqual({ kind: 'due' });
  });
});

describe('external copy usability', () => {
  const ok: ExternalCopyReadiness = {
    subscription: true,
    tablesNotReady: 0,
    rowState: 'members',
    copyState: 'ok',
    copyCheckedAt: new Date(100_000).toISOString(),
  };

  it('usable: subscribed, complete, members, confirmed in sync shortly before the outage', () => {
    expect(externalCopyUnusable(ok, 120_000, 300_000)).toBeNull();
  });

  it('names why not', () => {
    expect(externalCopyUnusable({ ...ok, subscription: false }, 120_000, 300_000)).toMatch(/no subscription/);
    expect(externalCopyUnusable({ ...ok, tablesNotReady: 3 }, 120_000, 300_000)).toMatch(/3 table/);
    expect(externalCopyUnusable({ ...ok, rowState: 'external' }, 120_000, 300_000)).toMatch(/says external/);
    expect(externalCopyUnusable({ ...ok, copyState: 'syncing' }, 120_000, 300_000)).toMatch(/syncing, not ok/);
    expect(externalCopyUnusable({ ...ok, copyCheckedAt: 'x' }, 120_000, 300_000)).toMatch(/no valid time/);
    expect(externalCopyUnusable(ok, 100_000 + 301_000, 300_000)).toMatch(/301 s before/);
  });

  it('checks the last complete copy, not a refresh / re-copy in progress ("complete as of", 2026-10-31)', () => {
    const recopying = {
      ...ok,
      copyState: 'syncing',
      copyCheckedAt: new Date(110_000).toISOString(),
      copyCompleteAt: new Date(100_000).toISOString(),
    };

    expect(externalCopyUnusable(recopying, 120_000, 300_000)).toBeNull();
    // Staleness is measured from the last complete copy.
    expect(externalCopyUnusable(recopying, 100_000 + 301_000, 300_000)).toMatch(/301 s before/);
    // Never complete: not usable.
    expect(externalCopyUnusable({ ...recopying, copyCompleteAt: null }, 120_000, 300_000)).toMatch(/syncing, not ok/);
  });
});

describe('epochs, scopes, fence records', () => {
  it('the takeover scope: cluster scope + epoch, a valid DNS label', () => {
    expect(takeoverPostgresScope('lw-abc', 2)).toBe('lw-abc-t2');
    const long = takeoverPostgresScope(`${'a'.repeat(59)}-bcd`, 12);

    expect(long.length).toBeLessThanOrEqual(63);
    expect(long).toMatch(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/);
    expect(long.endsWith('-t12')).toBe(true);
  });

  it('member data of an older epoch is fenced; none / a fresh member / current data is not', () => {
    expect(memberDataFenced({ database: true, state: 'members', epoch: 1 }, 2)).toBe(true);
    expect(memberDataFenced({ database: true, state: 'members', epoch: 2 }, 2)).toBe(false);
    expect(memberDataFenced({ database: true, state: null, epoch: null }, 2)).toBe(false);
    expect(memberDataFenced({ database: false, state: null, epoch: null }, 2)).toBe(false);
    expect(memberDataFenced({ database: true, state: 'members', epoch: 0 }, 0)).toBe(false);
  });

  it('fence info for members, target file fields', () => {
    expect(databaseFenceInfo({ epoch: 3, takenOverAt: '2026-10-31T10:00:00Z', scope: 'lw-abc-t3' })).toEqual({
      epoch: 3,
      takenOverAt: '2026-10-31T10:00:00.000Z',
      scope: 'lw-abc-t3',
    });
    expect(databaseFenceInfo({ epoch: undefined, takenOverAt: 'nope', scope: 'Bad Scope' })).toEqual({ epoch: 0 });

    const file = parseDatabaseTargetFile(
      JSON.stringify({
        version: 1,
        target: 'external',
        members: [],
        epoch: 2,
        takenOverAt: 't',
        postgresScope: 'lw-t2',
      }),
    );

    expect(file).toMatchObject({ epoch: 2, takenOverAt: 't', postgresScope: 'lw-t2' });
    expect(parseDatabaseTargetFile(JSON.stringify({ version: 1, target: 'external', members: [] }))).toMatchObject({
      epoch: 0,
      takenOverAt: null,
      postgresScope: null,
    });
  });

  it('fence records: deduped by node and time, the newest 20', () => {
    const record = (i: number): DatabaseFenceRecord => ({
      node: 'n1',
      epoch: 2,
      dataEpoch: 1,
      at: new Date(i * 1000).toISOString(),
      dataDir: '/d',
    });
    const one = withFenceRecord([], record(1)) as DatabaseFenceRecord[];

    expect(one).toHaveLength(1);
    expect(withFenceRecord(one, record(1))).toBeNull();

    let many: DatabaseFenceRecord[] = [];

    for (let i = 0; i < 25; i++) many = withFenceRecord(many, record(i)) ?? many;

    expect(many).toHaveLength(20);
    expect(many[0].at).toBe(record(5).at);
    expect(parseFenceRecords([{ node: 'x' }, record(1), null])).toEqual([record(1)]);
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(12_345_678)).toBe('12.3 MB');
  });
});

describe('database inbox items', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');

  it('critical while running on the database it took over, and while read-only without a takeover', () => {
    const items = databaseInboxItems(
      { location: 'external', readOnly: false, takenOverAt: '2026-10-31T10:00:00Z', takeoverBlocked: null, fences: [] },
      now,
    );

    expect(items).toEqual([
      expect.objectContaining({ kind: 'database', severity: 'critical', title: expect.stringMatching(/took over/) }),
    ]);
    expect(
      databaseInboxItems(
        {
          location: 'members',
          readOnly: true,
          takenOverAt: null,
          takeoverBlocked: 'the external copy is incomplete',
          fences: [],
        },
        now,
      ),
    ).toEqual([
      expect.objectContaining({
        severity: 'critical',
        title: "the cluster's database is read-only: the external copy is incomplete",
      }),
    ]);
    expect(
      databaseInboxItems(
        { location: 'members', readOnly: false, takenOverAt: null, takeoverBlocked: null, fences: [] },
        now,
      ),
    ).toEqual([]);
  });

  it('a warning per fenced member for a week: export or the kept directory', () => {
    const fence = (at: string, exported: boolean): DatabaseFenceRecord => ({
      node: 'n1',
      epoch: 2,
      dataEpoch: 1,
      at,
      dataDir: '/var/lib/loadweaver/postgres.fenced-e1-x',
      ...(exported
        ? { exportDir: '/var/lib/loadweaver/database-diverged-x', exportBytes: 2048, exportRows: 5 }
        : { exportError: 'the takeover time is unknown' }),
    });
    const items = databaseInboxItems(
      {
        location: 'members',
        readOnly: false,
        takenOverAt: null,
        takeoverBlocked: null,
        fences: [
          fence('2026-10-31T11:00:00Z', true),
          fence('2026-10-31T11:30:00Z', false),
          fence(new Date(now - FENCE_INBOX_MS - 1).toISOString(), true),
        ],
      },
      now,
    );

    expect(items.map((i) => i.title)).toEqual([
      'member n1 held data from before the takeover: moved aside to /var/lib/loadweaver/postgres.fenced-e1-x; 5 row(s) written after the takeover exported to /var/lib/loadweaver/database-diverged-x (2.0 KB) for review, not merged',
      'member n1 held data from before the takeover: moved aside to /var/lib/loadweaver/postgres.fenced-e1-x and kept (no export of rows written after the takeover: the takeover time is unknown)',
    ]);
    expect(items.every((i) => i.severity === 'warning')).toBe(true);
  });
});

describe('takeover SQL', () => {
  it('copyReadiness reads the subscription, its table states and the replicated row', async () => {
    const client = fakeClient([
      [/pg_subscription_rel/, [{ n: '2' }]],
      [/FROM pg_subscription s/, [{ oid: 7 }]],
      [
        /lw_database_handover/,
        [{ state: 'members', external_copy: { state: 'ok', checkedAt: 't', completeAt: 'c' }, epoch: '3' }],
      ],
    ]);

    expect(await copyReadiness(client)).toEqual({
      subscription: true,
      tablesNotReady: 2,
      rowState: 'members',
      copyState: 'ok',
      copyCheckedAt: 't',
      copyCompleteAt: 'c',
      rowEpoch: 3,
    });
    expect(await copyReadiness(fakeClient())).toMatchObject({ subscription: false, tablesNotReady: 0, rowState: null });
  });

  it('advanceSequences moves every owned sequence past its column, never backwards', async () => {
    const client = fakeClient([[/FROM pg_class s/, [{ seq: 'lw_audit_seq_seq', tbl: 'lw_audit', col: 'seq' }]]]);

    expect(await advanceSequences(client)).toBe(1);
    expect(client.sql[1]).toEqual({
      text: 'SELECT setval($1::regclass, GREATEST((SELECT last_value FROM "lw_audit_seq_seq"), (SELECT COALESCE(max("seq"), 0) FROM "lw_audit"), 1), true)',
      params: ['"lw_audit_seq_seq"'],
    });
  });

  it('memberDataState: no database, a row with and without the epoch column', async () => {
    const connect = jest.fn();

    expect(await memberDataState(fakeClient(), 'loadweaver', connect)).toEqual({
      database: false,
      state: null,
      epoch: null,
    });
    expect(connect).not.toHaveBeenCalled();

    const admin = fakeClient([[/pg_database/, [{ '?column?': 1 }]]]);
    const db = fakeClient([[/lw_database_handover/, [{ state: 'members', epoch: 0 }]]]);

    expect(await memberDataState(admin, 'loadweaver', async () => db)).toEqual({
      database: true,
      state: 'members',
      epoch: 0,
    });
    expect(db.end).toHaveBeenCalled();
    expect(await memberDataState(admin, 'loadweaver', async () => fakeClient())).toEqual({
      database: true,
      state: null,
      epoch: null,
    });
  });

  it('fenceMemberDatabase: fence settings, read-only, sessions cut; quoting', async () => {
    const admin = fakeClient();

    await fenceMemberDatabase(admin, 'loadweaver', { epoch: 2, takenOverAt: "2026'x", scope: null });
    expect(admin.sql.map((s) => s.text)).toEqual([
      'SET default_transaction_read_only = off',
      `ALTER DATABASE "loadweaver" SET loadweaver.fenced_epoch = '2'`,
      `ALTER DATABASE "loadweaver" SET loadweaver.fenced_at = '2026''x'`,
      'ALTER DATABASE "loadweaver" SET default_transaction_read_only = on',
      expect.stringMatching(/^SELECT pg_terminate_backend\(pid\)/),
    ]);
  });
});

describe('recordDatabaseFence (heartbeat databaseFence)', () => {
  const report = {
    epoch: 2,
    dataEpoch: 1,
    at: '2026-10-31T11:00:00.000Z',
    dataDir: '/d',
    exportDir: '/e',
    exportBytes: 1,
    exportRows: 1,
  };

  beforeEach(() => resetRecordedFences());

  it('records once (row + audit), skips while read-only, ignores repeats', async () => {
    const dataSource = {
      query: jest.fn(async (text: string) => (text.startsWith('SELECT') ? [{ fences: [] }] : [])),
    };
    const audit = { recordStandalone: jest.fn(async () => ({}) as never) };

    expect(await recordDatabaseFence(dataSource, audit, 'n1', report, { fallback: true, freeze: null })).toBe(false);
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(await recordDatabaseFence(dataSource, audit, 'n1', report, { fallback: false, freeze: null })).toBe(true);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('SET "fences"'), [
      JSON.stringify([{ node: 'n1', ...report }]),
    ]);
    expect(audit.recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'control-plane.database-fenced', target: 'nodes/n1' }),
    );
    expect(await recordDatabaseFence(dataSource, audit, 'n1', report, { fallback: false, freeze: null })).toBe(false);
    expect(audit.recordStandalone).toHaveBeenCalledTimes(1);
  });

  it('a report the row already has is not audited again (another replica recorded it)', async () => {
    const dataSource = { query: jest.fn(async () => [{ fences: [{ node: 'n1', ...report }] }]) };
    const audit = { recordStandalone: jest.fn(async () => ({}) as never) };

    expect(await recordDatabaseFence(dataSource, audit, 'n1', report, { fallback: false, freeze: null })).toBe(false);
    expect(audit.recordStandalone).not.toHaveBeenCalled();
  });
});

describe('Patroni scope after a takeover (platform backups, fresh members)', () => {
  it('the newer of the last cut-over and the last takeover wins', () => {
    const cutover = { scope: 'lw-abc-pitr1', createdAt: new Date('2026-10-30T00:00:00Z') };
    const takeover = { scope: 'lw-abc-t2', at: new Date('2026-10-31T00:00:00Z') };

    expect(newerPostgresScope(null, null)).toBeNull();
    expect(newerPostgresScope(cutover, null)).toBe('lw-abc-pitr1');
    expect(newerPostgresScope(null, takeover)).toBe('lw-abc-t2');
    expect(newerPostgresScope(cutover, takeover)).toBe('lw-abc-t2');
    expect(newerPostgresScope({ ...cutover, createdAt: new Date('2026-11-01T00:00:00Z') }, takeover)).toBe(
      'lw-abc-pitr1',
    );
  });

  it('reads the takeover scope from the handover row; nothing on errors', async () => {
    expect(
      await takeoverPostgresScopeOf({
        query: jest.fn(async () => [{ scope: 'lw-abc-t2', at: '2026-10-31T00:00:00Z' }]),
      } as never),
    ).toEqual({ scope: 'lw-abc-t2', at: new Date('2026-10-31T00:00:00Z') });
    expect(
      await takeoverPostgresScopeOf({ query: jest.fn(async () => [{ scope: null, at: null }]) } as never),
    ).toBeNull();
    expect(
      await takeoverPostgresScopeOf({ query: jest.fn(async () => Promise.reject(new Error('x'))) } as never),
    ).toBeNull();
  });
});
