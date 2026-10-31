import {
  activeTakeoverAt,
  databaseDeployment,
  copyCompleteAt,
  externalCopyAction,
  FALLBACK_AFTER_MS,
  FALLBACK_END_AFTER_POLLS,
  handoverBackoffMs,
  handoverDecision,
  initialFallbackState,
  isMutatingMethod,
  memberDatabaseFlag,
  nextFallback,
  parseDatabaseTargetFile,
  pendingMigrationNames,
  permanentSlotPatch,
  postgresRolePasswords,
  publishableTables,
  quoteIdent,
  quoteLiteral,
  RESYNC_AFTER_FAILING_MS,
  rowCountMismatches,
  schemaMismatches,
  subscriptionConninfo,
  withPostgresRolePasswords,
  writeBlockMessage,
  isDatabaseUnavailableError,
  type HandoverDecisionInput,
} from './database-handover.utils';

describe('databaseDeployment (3.43): on-node vs external', () => {
  it('is on-node when the agent says so', () => {
    expect(databaseDeployment({ LOADWEAVER_CONTROL_PLANE_ON_MEMBER: 'true', DB_HOST: 'postgres' })).toBe('on-node');
  });

  it("is on-node behind an older agent's leader proxy (loopback:5433)", () => {
    expect(databaseDeployment({ DB_HOST: '127.0.0.1', DB_PORT: '5433' })).toBe('on-node');
    expect(databaseDeployment({ DB_HOST: 'localhost', DB_PORT: '5433' })).toBe('on-node');
  });

  it('is external for the compose stack, whatever the built-in member mode', () => {
    expect(databaseDeployment({ DB_HOST: 'postgres', DB_PORT: '5432' })).toBe('external');
    expect(databaseDeployment({ DB_HOST: 'postgres', LOADWEAVER_BUILTIN_MEMBER: 'off' })).toBe('external');
    expect(databaseDeployment({ DB_HOST: '127.0.0.1', DB_PORT: '5432' })).toBe('external');
  });

  it('can be switched off for an external control plane', () => {
    expect(databaseDeployment({ DB_HOST: 'postgres', LOADWEAVER_DATABASE_HANDOVER: 'off' })).toBe('disabled');
    // On a member the switch doesn't matter.
    expect(
      databaseDeployment({ LOADWEAVER_CONTROL_PLANE_ON_MEMBER: 'true', LOADWEAVER_DATABASE_HANDOVER: 'off' }),
    ).toBe('on-node');
  });
});

describe('parseDatabaseTargetFile', () => {
  const valid = {
    version: 1,
    target: 'members',
    members: ['10.93.0.1'],
    caCertificatePem: '-----BEGIN CERTIFICATE-----',
    handoverId: 'h1',
    updatedAt: '2026-10-30T00:00:00.000Z',
  };

  it('reads a valid file', () => {
    expect(parseDatabaseTargetFile(JSON.stringify(valid))).toMatchObject({ target: 'members', members: ['10.93.0.1'] });
  });

  it('refuses garbage and a members target without addresses or CA (stays external)', () => {
    expect(parseDatabaseTargetFile(null)).toBeNull();
    expect(parseDatabaseTargetFile('{')).toBeNull();
    expect(parseDatabaseTargetFile(JSON.stringify({ ...valid, version: 2 }))).toBeNull();
    expect(parseDatabaseTargetFile(JSON.stringify({ ...valid, members: [] }))).toBeNull();
    expect(parseDatabaseTargetFile(JSON.stringify({ ...valid, caCertificatePem: null }))).toBeNull();
    expect(parseDatabaseTargetFile(JSON.stringify({ ...valid, target: 'external', members: [] }))).toMatchObject({
      target: 'external',
    });
  });
});

describe('handoverDecision (state machine)', () => {
  const base: HandoverDecisionInput = {
    target: 'external',
    fallback: false,
    realMembers: 1,
    leaderReachable: true,
    row: 'external',
    backingOff: false,
  };

  it('hands over once a real member has a reachable leader', () => {
    expect(handoverDecision(base)).toEqual({ kind: 'handover' });
    expect(handoverDecision({ ...base, row: null })).toEqual({ kind: 'handover' });
    // A crashed attempt (row left in `handover`) is retried.
    expect(handoverDecision({ ...base, row: 'handover' })).toEqual({ kind: 'handover' });
  });

  it('waits without members, without a leader, or while backing off', () => {
    expect(handoverDecision({ ...base, realMembers: 0 }).kind).toBe('wait');
    expect(handoverDecision({ ...base, leaderReachable: false }).kind).toBe('wait');
    expect(handoverDecision({ ...base, backingOff: true }).kind).toBe('wait');
  });

  it('adopts a handover another replica did', () => {
    expect(handoverDecision({ ...base, row: 'members', leaderReachable: false })).toEqual({ kind: 'adopt' });
  });

  it('on the members: syncs, serves read-only while unreachable, returns at r = 0', () => {
    const members = { ...base, target: 'members' as const, row: 'members' as const };

    expect(handoverDecision(members)).toEqual({ kind: 'sync' });
    expect(handoverDecision({ ...members, fallback: true })).toEqual({ kind: 'read-only' });
    // Unreachable is not removed: never a takeover while members are registered.
    expect(handoverDecision({ ...members, fallback: true, leaderReachable: false })).toEqual({ kind: 'read-only' });
    expect(handoverDecision({ ...members, realMembers: 0 })).toEqual({ kind: 'return' });
    expect(handoverDecision({ ...members, realMembers: 0, fallback: true })).toEqual({ kind: 'return' });
  });
});

describe('write guard decisions', () => {
  it('blocks writes during a handover and the read-only fallback with a clear message', () => {
    expect(writeBlockMessage({ freeze: null, fallback: false })).toBeNull();
    expect(writeBlockMessage({ freeze: 'handover', fallback: false })).toMatch(/moving its database.*retry/);
    expect(writeBlockMessage({ freeze: null, fallback: true })).toBe(
      "the cluster's database members are unreachable; read-only until one is back",
    );
  });

  it('blocks writes as soon as the leader is missing, with the same message as the fallback (3.43)', () => {
    expect(writeBlockMessage({ freeze: null, fallback: false, leaderMissing: true })).toBe(
      writeBlockMessage({ freeze: null, fallback: true }),
    );
  });

  it('recognises errors of an unreachable / unavailable database, not failing queries', () => {
    const queryFailed = (code: string, message = 'x') => ({ message, driverError: { code, message } });

    expect(isDatabaseUnavailableError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))).toBe(
      true,
    );
    expect(isDatabaseUnavailableError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isDatabaseUnavailableError(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(
      isDatabaseUnavailableError(queryFailed('57P01', 'terminating connection due to administrator command')),
    ).toBe(true);
    expect(isDatabaseUnavailableError(queryFailed('57P03', 'the database system is starting up'))).toBe(true);
    expect(isDatabaseUnavailableError(queryFailed('08006'))).toBe(true);
    expect(isDatabaseUnavailableError(queryFailed('25006', 'cannot execute INSERT in a read-only transaction'))).toBe(
      true,
    );
    expect(isDatabaseUnavailableError(queryFailed('23505', 'duplicate key value violates unique constraint'))).toBe(
      false,
    );
    expect(isDatabaseUnavailableError(new Error('not found'))).toBe(false);
    expect(isDatabaseUnavailableError(null)).toBe(false);
  });

  it('treats everything but GET / HEAD / OPTIONS as a write', () => {
    expect(['GET', 'head', 'OPTIONS', undefined].map(isMutatingMethod)).toEqual([false, false, false, false]);
    expect(['POST', 'PUT', 'PATCH', 'DELETE'].map(isMutatingMethod)).toEqual([true, true, true, true]);
  });
});

describe('nextFallback (read-only fallback)', () => {
  it('falls back only after no primary for FALLBACK_AFTER_MS (a failover is not an outage)', () => {
    let s = nextFallback(initialFallbackState(), true, 0);

    s = nextFallback(s, false, 1_000);
    expect(s.fallback).toBe(false);
    s = nextFallback(s, false, 1_000 + FALLBACK_AFTER_MS - 1);
    expect(s.fallback).toBe(false);
    s = nextFallback(s, false, 1_000 + FALLBACK_AFTER_MS);
    expect(s.fallback).toBe(true);
  });

  it('falls back at once when the process never reached the members since it started', () => {
    expect(nextFallback(initialFallbackState(), false, 0, true).fallback).toBe(true);
  });

  it('ends after the primary answered FALLBACK_END_AFTER_POLLS polls in a row', () => {
    let s = { fallback: true, missingSince: 0, seen: 0 };

    for (let i = 1; i < FALLBACK_END_AFTER_POLLS; i++) {
      s = nextFallback(s, true, i);
      expect(s.fallback).toBe(true);
    }

    s = nextFallback(s, false, 10);
    expect(s).toMatchObject({ fallback: true, seen: 0 });

    for (let i = 0; i < FALLBACK_END_AFTER_POLLS; i++) s = nextFallback(s, true, 20 + i);

    expect(s).toEqual(initialFallbackState());
  });
});

describe('memberDatabaseFlag', () => {
  it('is set only by an external control plane', () => {
    expect(memberDatabaseFlag('external', 'external')).toBe('pending');
    expect(memberDatabaseFlag('external', null)).toBe('pending');
    expect(memberDatabaseFlag('external', 'members')).toBe('ready');
    expect(memberDatabaseFlag('on-node', 'external')).toBeUndefined();
    expect(memberDatabaseFlag('disabled', null)).toBeUndefined();
  });
});

describe('copy / replication helpers', () => {
  it('publishes tables with a primary key, never hypertables or the migration bookkeeping', () => {
    expect(
      publishableTables([
        { name: 'lw_nodes', primaryKey: true, hypertable: false },
        { name: 'migrations', primaryKey: true, hypertable: false },
        { name: 'lw_metric_samples', primaryKey: true, hypertable: true },
        { name: 'lw_no_pk', primaryKey: false, hypertable: false },
        { name: 'lw_audit_events', primaryKey: true, hypertable: false },
        { name: 'lw_metrics', primaryKey: true, hypertable: false },
        { name: 'lw_flows_1h', primaryKey: true, hypertable: false },
        { name: 'lw_metricsx', primaryKey: true, hypertable: false },
      ]),
    ).toEqual({
      published: ['lw_audit_events', 'lw_metricsx', 'lw_nodes'],
      skipped: ['lw_flows_1h', 'lw_metric_samples', 'lw_metrics', 'lw_no_pk'],
    });
  });

  it('reports row-count and schema differences', () => {
    expect(rowCountMismatches({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(['b: 2 → 3']);
    expect(rowCountMismatches({ a: 1 }, {})).toEqual(['a: 1 → missing']);
    expect(schemaMismatches({ a: ['id', 'x'], b: ['id'] }, { a: ['id'] })).toEqual([
      "a: columns x are missing on the members' database",
      "table b is missing on the members' database",
    ]);
    expect(schemaMismatches({ a: ['id'] }, { a: ['id', 'new'] })).toEqual([]);
  });

  it('quotes identifiers and literals', () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
    expect(quoteLiteral("it's")).toBe("'it''s'");
  });

  it('builds the subscription connection over every member with read-write targeting', () => {
    const info = subscriptionConninfo({
      members: ['10.93.0.1', '10.93.0.2'],
      port: 5432,
      database: 'loadweaver',
      user: 'postgres',
      password: "p'w\\d",
    });

    expect(info).toContain("host='10.93.0.1,10.93.0.2'");
    expect(info).toContain("port='5432,5432'");
    expect(info).toContain("password='p\\'w\\\\d'");
    expect(info).toContain('target_session_attrs=read-write');
    expect(info).toContain('sslmode=require');
  });

  it('decides what the external copy needs', () => {
    const ok = {
      subscription: true,
      slotOnPrimary: true,
      pendingMigrations: 0,
      unsubscribedTables: 0,
      failingForMs: 0,
    };

    expect(externalCopyAction(ok)).toEqual({ kind: 'ok' });
    expect(externalCopyAction({ ...ok, pendingMigrations: 2 })).toEqual({ kind: 'migrate' });
    expect(externalCopyAction({ ...ok, subscription: false })).toEqual({ kind: 'create' });
    expect(externalCopyAction({ ...ok, slotOnPrimary: false }).kind).toBe('resync');
    expect(externalCopyAction({ ...ok, failingForMs: RESYNC_AFTER_FAILING_MS }).kind).toBe('resync');
    expect(externalCopyAction({ ...ok, failingForMs: RESYNC_AFTER_FAILING_MS - 1 })).toEqual({ kind: 'ok' });
    expect(externalCopyAction({ ...ok, unsubscribedTables: 1 })).toEqual({ kind: 'refresh' });
  });

  it('after a failover: keeps the copy when the new primary held the slot, copies again when it did not (2026-10-31)', () => {
    const ok = {
      subscription: true,
      slotOnPrimary: true,
      pendingMigrations: 0,
      unsubscribedTables: 0,
      failingForMs: 0,
      leader: 'b',
      previousLeader: 'a',
    };

    expect(externalCopyAction({ ...ok, previousSlotHolders: ['a', 'b'] })).toEqual({ kind: 'ok' });
    expect(externalCopyAction({ ...ok, previousSlotHolders: ['a'] })).toMatchObject({
      kind: 'resync',
      reason: expect.stringMatching(/new primary b held no copy/),
    });
    // Unknown holders (a report from before the failover slots), or no leader change: nothing to compare.
    expect(externalCopyAction({ ...ok, previousSlotHolders: null })).toEqual({ kind: 'ok' });
    expect(externalCopyAction({ ...ok, previousLeader: 'b', previousSlotHolders: ['a'] })).toEqual({ kind: 'ok' });
    // A slot that is gone stays a re-copy.
    expect(externalCopyAction({ ...ok, slotOnPrimary: false, previousSlotHolders: ['a', 'b'] }).kind).toBe('resync');
  });

  it('tables still copying, a disabled subscription', () => {
    const ok = {
      subscription: true,
      slotOnPrimary: true,
      pendingMigrations: 0,
      unsubscribedTables: 0,
      failingForMs: 0,
    };

    expect(externalCopyAction({ ...ok, tablesNotReady: 2, syncingForMs: 1_000 })).toEqual({ kind: 'syncing' });
    expect(externalCopyAction({ ...ok, tablesNotReady: 2, syncingForMs: RESYNC_AFTER_FAILING_MS }).kind).toBe('resync');
    expect(externalCopyAction({ ...ok, enabled: false })).toEqual({ kind: 'enable' });
    // Live 3.43: disabled with 105 tables in `i` → a re-copy (enabling would copy into tables that still hold rows).
    expect(externalCopyAction({ ...ok, enabled: false, tablesNotReady: 105 }).kind).toBe('resync');
  });

  it('builds the Patroni patch for the permanent logical slot', () => {
    expect(permanentSlotPatch({}, 'lw_external_copy_a', 'loadweaver')).toEqual({
      slots: { lw_external_copy_a: { type: 'logical', database: 'loadweaver', plugin: 'pgoutput' } },
      postgresql: { parameters: { hot_standby_feedback: 'on' } },
    });

    const registered = {
      slots: { lw_external_copy_a: { type: 'logical', database: 'loadweaver', plugin: 'pgoutput' }, other: {} },
      postgresql: { parameters: { wal_level: 'logical', hot_standby_feedback: true } },
    };

    expect(permanentSlotPatch(registered, 'lw_external_copy_a', 'loadweaver')).toBeNull();
    // A new subscription's slot replaces the old one; slots of others stay.
    expect(permanentSlotPatch(registered, 'lw_external_copy_b', 'loadweaver')).toEqual({
      slots: {
        lw_external_copy_a: null,
        lw_external_copy_b: { type: 'logical', database: 'loadweaver', plugin: 'pgoutput' },
      },
    });
    expect(permanentSlotPatch(registered, null, 'loadweaver')).toEqual({ slots: { lw_external_copy_a: null } });
    expect(permanentSlotPatch(null, null, 'loadweaver')).toBeNull();
  });

  it('carries "complete as of" through syncing / error reports', () => {
    expect(copyCompleteAt('t0', { state: 'ok', checkedAt: 't1' })).toBe('t1');
    expect(copyCompleteAt('t0', { state: 'syncing', checkedAt: 't1' })).toBe('t0');
    expect(copyCompleteAt(undefined, { state: 'error', checkedAt: 't1' })).toBeNull();
  });

  it('lists the migrations the external copy has not run', () => {
    expect(pendingMigrationNames(['A1', 'B2', 'C3'], ['A1', 'B2'])).toEqual(['C3']);
    expect(pendingMigrationNames(['A1'], ['A1'])).toEqual([]);
  });

  it('backs off a failed handover, doubling up to 10 minutes', () => {
    expect(handoverBackoffMs(1)).toBe(30_000);
    expect(handoverBackoffMs(2)).toBe(60_000);
    expect(handoverBackoffMs(20)).toBe(600_000);
  });
});

describe('postgresRolePasswords (user decision 2026-10-30): derived from ENCRYPTION_KEY when unset', () => {
  const key = 'k'.repeat(43);

  it('is stable per key, distinct per purpose and per key', () => {
    const a = postgresRolePasswords(key);

    expect(postgresRolePasswords(key)).toEqual(a);
    expect(a.replication).not.toBe(a.admin);
    expect(a.replication).toMatch(/^[0-9a-f]{48}$/);
    expect(postgresRolePasswords('j'.repeat(43)).replication).not.toBe(a.replication);
    expect(postgresRolePasswords('j'.repeat(43)).admin).not.toBe(a.admin);
  });

  it('fills unset or empty values, explicit ones win, nothing without a key', () => {
    const derived = postgresRolePasswords(key);

    expect(withPostgresRolePasswords({ DB_USERNAME: 'postgres' }, { ENCRYPTION_KEY: key })).toEqual({
      DB_USERNAME: 'postgres',
      LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: derived.replication,
      LOADWEAVER_POSTGRES_ADMIN_PASSWORD: derived.admin,
    });
    expect(
      withPostgresRolePasswords(
        { LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: 'repl', LOADWEAVER_POSTGRES_ADMIN_PASSWORD: '' },
        { ENCRYPTION_KEY: key },
      ),
    ).toEqual({ LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: 'repl', LOADWEAVER_POSTGRES_ADMIN_PASSWORD: derived.admin });
    expect(withPostgresRolePasswords({ DB_USERNAME: 'postgres' }, {})).toEqual({ DB_USERNAME: 'postgres' });
  });
});

describe('activeTakeoverAt (3.43 live test: takenOverAt stayed after the handover)', () => {
  const at = '2026-10-31T12:19:46.000Z';

  it('reports the takeover only while the external target runs on it', () => {
    expect(activeTakeoverAt({ target: 'external', epoch: 1, takenOverAt: at, takeoverEpoch: 1 })).toBe(at);
    expect(activeTakeoverAt({ target: 'members', epoch: 2, takenOverAt: at, takeoverEpoch: 1 })).toBeNull();
    expect(activeTakeoverAt({ target: 'external', epoch: 2, takenOverAt: at, takeoverEpoch: 1 })).toBeNull();
    expect(activeTakeoverAt({ target: 'external', epoch: 1, takenOverAt: null, takeoverEpoch: 1 })).toBeNull();
    expect(activeTakeoverAt(null)).toBeNull();
  });

  it("falls back to the takeover scope's epoch for files without takeoverEpoch", () => {
    expect(activeTakeoverAt({ target: 'external', epoch: 3, takenOverAt: at, postgresScope: 'lw-e9fb7247-t3' })).toBe(
      at,
    );
    expect(
      activeTakeoverAt({ target: 'external', epoch: 4, takenOverAt: at, postgresScope: 'lw-e9fb7247-t3' }),
    ).toBeNull();
    expect(activeTakeoverAt({ target: 'external', epoch: 3, takenOverAt: at })).toBeNull();
  });

  it('parses takeoverEpoch from the target file', () => {
    const base = { version: 1, target: 'external', members: [], caCertificatePem: null, handoverId: null };

    expect(parseDatabaseTargetFile(JSON.stringify({ ...base, takeoverEpoch: 3 }))?.takeoverEpoch).toBe(3);
    expect(parseDatabaseTargetFile(JSON.stringify({ ...base, takeoverEpoch: -1 }))?.takeoverEpoch).toBeNull();
    expect(parseDatabaseTargetFile(JSON.stringify(base))?.takeoverEpoch).toBeNull();
  });
});
