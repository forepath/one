import { copyDatabase } from './database-copy';
import { DatabaseHandoverService, type HandoverDeps } from './database-handover.service';
import { databaseTarget } from './database-target.runtime';
import type { DatabaseTargetFile } from './database-handover.utils';
import {
  createSlotWithSnapshot,
  createSubscription,
  disableSubscription,
  dropSlot,
  dropSubscription,
  enableSubscription,
  ensurePublication,
  externalCopyStatus,
  holdsSlot,
  refreshSubscription,
  walLevel,
} from './external-copy';

jest.mock('./database-copy', () => ({ copyDatabase: jest.fn() }));
jest.mock('./external-copy', () => ({
  ensurePublication: jest.fn(),
  walLevel: jest.fn(),
  dropSubscription: jest.fn(),
  dropSlot: jest.fn(),
  createSubscription: jest.fn(),
  refreshSubscription: jest.fn(),
  externalCopyStatus: jest.fn(),
  disableSubscription: jest.fn(),
  enableSubscription: jest.fn(),
  createSlotWithSnapshot: jest.fn(),
  holdsSlot: jest.fn(),
}));

const copyMock = copyDatabase as jest.MockedFunction<typeof copyDatabase>;

interface FakeClient {
  sql: string[];
  query: jest.Mock;
  end: jest.Mock;
}

function fakeClient(responses: [RegExp, unknown[]][] = []): FakeClient {
  const sql: string[] = [];

  return {
    sql,
    query: jest.fn(async (text: string, params?: unknown[]) => {
      sql.push(`${text.replace(/\s+/g, ' ').trim()}${params ? ` ${JSON.stringify(params)}` : ''}`);

      return { rows: responses.find(([re]) => re.test(text))?.[1] ?? [] };
    }),
    end: jest.fn(async () => undefined),
  };
}

const CA = '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----';

function setup(options: {
  members?: { name: string; overlayV4: string | null; sealPublicKey: string | null }[];
  row?: string | null;
  file?: Partial<DatabaseTargetFile> | null;
  primary?: string | null;
  primaries?: string[];
  existingDatabase?: boolean;
  externalResponses?: [RegExp, unknown[]][];
}) {
  const nodes = options.members ?? [{ name: 'n1', overlayV4: '10.93.0.1', sealPublicKey: 'pk' }];
  const dataSource = {
    getRepository: () => ({ find: jest.fn(async () => nodes) }),
    query: jest.fn(async (text: string) =>
      text.includes('SELECT "state"') && options.row ? [{ state: options.row }] : [],
    ),
    options: {},
  };
  const identity = { caCertificate: jest.fn(async () => CA), cluster: jest.fn(async () => ({ clusterId: 'lw-abc' })) };
  const audit = { recordStandalone: jest.fn(async () => ({})) };
  const service = new DatabaseHandoverService(dataSource as never, identity as never, audit as never);
  const external = fakeClient([[/pg_try_advisory_lock/, [{ locked: true }]], ...(options.externalResponses ?? [])]);
  const admin = fakeClient([
    [/pg_is_in_recovery/, [{ recovery: false }]],
    [/FROM pg_database/, options.existingDatabase ? [{ '?column?': 1 }] : []],
  ]);
  const membersDb = fakeClient();
  const files: DatabaseTargetFile[] = [];
  const deps: HandoverDeps & { [K in keyof HandoverDeps]: jest.Mock } = {
    findPrimary: jest.fn(async () => (options.primary === undefined ? '10.93.0.1' : options.primary)),
    findPrimaries: jest.fn(async () => {
      if (options.primaries) return options.primaries;

      const primary = options.primary === undefined ? '10.93.0.1' : options.primary;

      return primary ? [primary] : [];
    }),
    connectExternal: jest.fn(async () => external),
    connectMembers: jest.fn(async (_address: string, database: string) =>
      database === 'postgres' ? admin : membersDb,
    ),
    migrate: jest.fn(async () => undefined),
    patroni: jest.fn(async () => 200),
    patroniGet: jest.fn(async () => ({})),
    writeFile: jest.fn(async (file: DatabaseTargetFile) => void files.push(file)),
    restart: jest.fn(),
    sleep: jest.fn(async () => undefined),
    now: jest.fn(() => 1_000_000),
  };

  databaseTarget.reset();
  databaseTarget.deployment = 'external';
  databaseTarget.file = options.file
    ? {
        version: 1,
        target: 'external',
        members: [],
        caCertificatePem: null,
        handoverId: null,
        updatedAt: '',
        ...options.file,
      }
    : null;
  service.runtime = databaseTarget;
  service.deps = deps;
  service.env = { DB_DATABASE: 'loadweaver', DB_USERNAME: 'postgres', DB_PASSWORD: 'pw' };

  return { service, deps, external, admin, membersDb, files, audit, dataSource };
}

beforeEach(() => {
  jest.clearAllMocks();
  copyMock.mockResolvedValue({ tables: 2, rows: 10, sequences: 1, counts: {} });
  (ensurePublication as jest.Mock).mockResolvedValue({ published: ['lw_nodes'], skipped: [] });
  (walLevel as jest.Mock).mockResolvedValue('logical');
  (dropSubscription as jest.Mock).mockResolvedValue(null);
  (dropSlot as jest.Mock).mockResolvedValue(undefined);
  (createSlotWithSnapshot as jest.Mock).mockResolvedValue({ snapshot: '00000003-1', consistentPoint: '0/1' });
  (holdsSlot as jest.Mock).mockResolvedValue(false);
});

afterEach(() => databaseTarget.reset());

describe('DatabaseHandoverService (3.43)', () => {
  it('hands the database over: freeze, create, migrate, copy, mark, subscribe, persist, restart', async () => {
    const { service, deps, external, admin, membersDb, files } = setup({ row: 'external' });

    await service.tick();

    expect(admin.sql).toContain('CREATE DATABASE "loadweaver" OWNER "postgres"');
    expect(external.sql).toContain('ALTER DATABASE "loadweaver" SET default_transaction_read_only = on');
    expect(external.sql.some((s) => s.startsWith('SELECT pg_terminate_backend'))).toBe(true);
    expect(deps.migrate).toHaveBeenCalledWith({ address: '10.93.0.1' });
    expect(copyMock).toHaveBeenCalledWith(external, membersDb);
    expect(membersDb.sql.some((s) => s.includes('"lw_database_handover"') && s.includes('["members"'))).toBe(true);
    expect(external.sql.some((s) => s.includes('"lw_database_handover"') && s.includes('["members"'))).toBe(true);
    expect(createSubscription).toHaveBeenCalledWith(
      external,
      expect.stringContaining("host='10.93.0.1'"),
      expect.objectContaining({ copyData: false, tables: ['lw_nodes'] }),
    );
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      target: 'members',
      members: ['10.93.0.1'],
      caCertificatePem: CA,
      pendingAudit: { action: 'control-plane.database-handover', details: { rows: 10, externalCopy: 'ok' } },
    });
    // Frozen until the process is gone (the restart).
    expect(databaseTarget.freeze).toBe('handover');
    expect(deps.restart).toHaveBeenCalledTimes(1);
  });

  it('reads the cluster CA before the freeze, not through the pool whose sessions the freeze ends (live 3.43)', async () => {
    const { service, deps, files } = setup({ row: 'external' });
    const identity = (service as unknown as { identity: { caCertificate: jest.Mock } }).identity;

    identity.caCertificate.mockImplementation(async () => {
      if (databaseTarget.freeze) throw new Error('terminating connection due to administrator command');

      return CA;
    });

    await service.tick();

    expect(files[0]).toMatchObject({ target: 'members', caCertificatePem: CA });
    expect(deps.restart).toHaveBeenCalledTimes(1);
  });

  it('aborts a failed copy: lifts the freeze, drops the half-made database, backs off', async () => {
    const { service, deps, external, admin, files } = setup({ row: 'external' });

    copyMock.mockRejectedValueOnce(new Error('row counts differ after the copy: lw_nodes: 1 → 0'));
    await service.tick();

    expect(external.sql).toContain('ALTER DATABASE "loadweaver" RESET default_transaction_read_only');
    expect(admin.sql).toContain('DROP DATABASE IF EXISTS "loadweaver" WITH (FORCE)');
    expect(databaseTarget.freeze).toBeNull();
    expect(files).toHaveLength(0);
    expect(deps.restart).not.toHaveBeenCalled();
    expect(service.status().lastError).toMatch(/row counts differ/);

    // Backing off: no second attempt right away.
    deps.connectExternal.mockClear();
    await service.tick();
    expect(deps.connectExternal).not.toHaveBeenCalled();
  });

  it('still hands over when the external copy cannot be set up (reported, retried later)', async () => {
    const { service, deps, files } = setup({ row: 'external' });

    (createSubscription as jest.Mock).mockRejectedValueOnce(new Error('could not connect to the publisher'));
    await service.tick();

    expect(files[0].pendingAudit?.details).toMatchObject({ externalCopy: 'error' });
    expect(deps.restart).toHaveBeenCalled();
  });

  it('waits without a real member or without a reachable leader', async () => {
    const none = setup({ members: [{ name: 'n1', overlayV4: '10.93.0.1', sealPublicKey: null }] });

    await none.service.tick();
    expect(none.deps.findPrimaries).not.toHaveBeenCalled();
    expect(none.deps.connectExternal).not.toHaveBeenCalled();

    const unreachable = setup({ primary: null });

    await unreachable.service.tick();
    expect(unreachable.deps.connectExternal).not.toHaveBeenCalled();
  });

  it('drops a database a failed attempt left behind, but adopts one the members already own', async () => {
    const leftover = setup({ row: 'external', existingDatabase: true });

    await leftover.service.tick();
    expect(leftover.admin.sql).toContain('DROP DATABASE "loadweaver" WITH (FORCE)');

    const owned = setup({ row: 'external', existingDatabase: true });

    owned.membersDb.query.mockImplementation(async () => ({ rows: [{ state: 'members' }] }));
    await owned.service.tick();
    expect(owned.admin.sql.some((s) => s.startsWith('DROP DATABASE'))).toBe(false);
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(owned.files.at(-1)).toMatchObject({ target: 'members', members: ['10.93.0.1'] });
    expect(owned.deps.restart).toHaveBeenCalled();
  });

  it('adopts a handover another replica did', async () => {
    const { service, deps, files } = setup({ row: 'members', primary: null });

    await service.tick();
    expect(files).toEqual([
      expect.objectContaining({ target: 'members', members: ['10.93.0.1'], caCertificatePem: CA }),
    ]);
    expect(deps.restart).toHaveBeenCalled();
    expect(copyMock).not.toHaveBeenCalled();
  });

  it('returns to the external copy at r = 0: subscription dropped, row reset, audited after the restart', async () => {
    const { service, deps, external, files } = setup({
      members: [],
      row: 'members',
      file: { target: 'members', members: ['10.93.0.1'], caCertificatePem: CA, handoverId: 'h1' },
    });

    (dropSubscription as jest.Mock).mockResolvedValueOnce('lw_external_copy_abc');
    await service.tick();

    expect(dropSubscription).toHaveBeenCalledWith(external);
    expect(dropSlot).toHaveBeenCalledWith(expect.anything(), 'lw_external_copy_abc');
    expect(external.sql.some((s) => s.includes('"lw_database_handover"') && s.includes('["external","h1",0]'))).toBe(
      true,
    );
    expect(files.at(-1)).toMatchObject({
      target: 'external',
      members: [],
      pendingAudit: { action: 'control-plane.database-return', handoverId: 'h1' },
    });
    expect(deps.restart).toHaveBeenCalled();
  });

  it('serves read-only while every member is unreachable, before the takeover is due: never promotes, never returns', async () => {
    const { service, deps, files } = setup({
      row: 'members',
      file: { target: 'members', members: ['10.93.0.1'], caCertificatePem: CA },
    });

    databaseTarget.fallback = true;
    await service.tick();
    expect(deps.connectExternal).not.toHaveBeenCalled();
    expect(files).toHaveLength(0);
    expect(deps.restart).not.toHaveBeenCalled();
    expect(service.status()).toMatchObject({
      location: 'members',
      readOnly: true,
      readOnlyReason: "the cluster's database members are unreachable; read-only until one is back",
    });
  });

  it('restarts once the members are back when it started in the fallback', async () => {
    const { service, deps } = setup({
      row: 'members',
      file: { target: 'members', members: ['10.93.0.1'], caCertificatePem: CA },
    });

    databaseTarget.startedInFallback = true;
    await service.tick();
    expect(deps.restart).toHaveBeenCalled();
  });

  it('records the audit event of the last switch on the database it uses now', async () => {
    const { service, audit, files } = setup({
      row: 'members',
      file: {
        target: 'members',
        members: ['10.93.0.1'],
        caCertificatePem: CA,
        pendingAudit: { action: 'control-plane.database-handover', handoverId: 'h1', at: 'now', details: { rows: 3 } },
      },
    });

    (externalCopyStatus as jest.Mock).mockResolvedValue({
      subscription: true,
      slotOnPrimary: true,
      pendingMigrations: 0,
      unsubscribedTables: 0,
      failing: false,
      slot: 's',
      published: [],
    });
    await service.tick();

    expect(audit.recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'control-plane.database-handover',
        target: 'control-plane/database',
        details: expect.objectContaining({ handoverId: 'h1', rows: 3 }),
      }),
    );
    expect(files[0].pendingAudit).toBeNull();
  });

  it('runs new migrations on the external copy before refreshing the subscription', async () => {
    const order = (fn: unknown) => (fn as jest.Mock).mock.invocationCallOrder[0];
    const { service, deps, external } = setup({
      row: 'members',
      file: { target: 'members', members: ['10.93.0.1'], caCertificatePem: CA },
    });

    (externalCopyStatus as jest.Mock).mockResolvedValue({
      subscription: true,
      slotOnPrimary: true,
      pendingMigrations: 1,
      unsubscribedTables: 1,
      failing: false,
      slot: 's',
      published: ['lw_new'],
    });
    await service.tick();

    expect(disableSubscription).toHaveBeenCalledWith(external);
    expect(deps.migrate).toHaveBeenCalledWith('external');
    expect(order(disableSubscription)).toBeLessThan(order(deps.migrate));
    expect(order(deps.migrate)).toBeLessThan(order(enableSubscription));
    expect(refreshSubscription).toHaveBeenCalledWith(external);
    expect(order(deps.migrate)).toBeLessThan(order(refreshSubscription));
    expect(service.status().externalCopy).toMatchObject({ state: 'syncing' });
  });

  it('clears the last error once a step on the members succeeds again (live 3.43: stale after recovery)', async () => {
    const { service } = setup({
      row: 'members',
      file: { target: 'members', members: ['10.93.0.1'], caCertificatePem: CA },
    });

    (service as unknown as { lastError: string | null }).lastError = 'the database system is shutting down';
    (externalCopyStatus as jest.Mock).mockResolvedValue({
      subscription: true,
      slotOnPrimary: true,
      pendingMigrations: 0,
      unsubscribedTables: 0,
      failing: false,
      slot: 's',
      published: ['lw_new'],
    });
    await service.tick();
    expect(service.status().lastError).toBeNull();
  });

  describe('external copy across failovers (3.43, "failover slots + keep copy")', () => {
    const file = { target: 'members' as const, members: ['10.93.0.1', '10.93.0.2'], caCertificatePem: CA };
    const members = [
      { name: 'n1', overlayV4: '10.93.0.1', sealPublicKey: 'pk' },
      { name: 'n2', overlayV4: '10.93.0.2', sealPublicKey: 'pk' },
    ];
    const healthy = {
      subscription: true,
      slotOnPrimary: true,
      pendingMigrations: 0,
      unsubscribedTables: 0,
      failing: false,
      slot: 'lw_external_copy_old',
      published: ['lw_nodes'],
      enabled: true,
      tablesNotReady: 0,
    };
    const previous = (report: Record<string, unknown>) => (svc: DatabaseHandoverService) =>
      ((svc as unknown as { externalCopy: unknown }).externalCopy = {
        state: 'ok',
        error: null,
        checkedAt: '2026-10-31T10:00:00.000Z',
        completeAt: '2026-10-31T10:00:00.000Z',
        ...report,
      });

    it('registers the slot as a Patroni permanent logical slot and reports the holders and "complete as of"', async () => {
      const { service, deps } = setup({ members, row: 'members', file });

      (externalCopyStatus as jest.Mock).mockResolvedValue(healthy);
      (holdsSlot as jest.Mock).mockResolvedValue(true);
      await service.tick();

      expect(deps.patroniGet).toHaveBeenCalledWith('10.93.0.1', '/config');
      expect(deps.patroni).toHaveBeenCalledWith('10.93.0.1', 'PATCH', '/config', {
        slots: { lw_external_copy_old: { type: 'logical', database: 'loadweaver', plugin: 'pgoutput' } },
        postgresql: { parameters: { hot_standby_feedback: 'on' } },
      });
      expect(service.status().externalCopy).toMatchObject({
        state: 'ok',
        leader: '10.93.0.1',
        slot: 'lw_external_copy_old',
        slotHolders: ['10.93.0.1', '10.93.0.2'],
        failoverSlot: true,
        completeAt: new Date(1_000_000).toISOString(),
      });
    });

    it('a failover onto a replica that held the slot keeps the copy: no re-copy', async () => {
      const { service } = setup({ members, row: 'members', file, primary: '10.93.0.2' });

      previous({ leader: '10.93.0.1', slot: 'lw_external_copy_old', slotHolders: ['10.93.0.1', '10.93.0.2'] })(service);
      (externalCopyStatus as jest.Mock).mockResolvedValue(healthy);
      await service.tick();

      expect(createSlotWithSnapshot).not.toHaveBeenCalled();
      expect(dropSubscription).not.toHaveBeenCalled();
      expect(service.status().externalCopy).toMatchObject({ state: 'ok', leader: '10.93.0.2' });
    });

    it('re-copies without destroying the copy when the slot is lost: snapshot slot, one transaction, then swap', async () => {
      const { service, deps, external, membersDb } = setup({ members, row: 'members', file });

      previous({ leader: '10.93.0.1', slotHolders: ['10.93.0.1'] })(service);
      (externalCopyStatus as jest.Mock).mockResolvedValue({ ...healthy, slotOnPrimary: false, failing: true });
      (dropSubscription as jest.Mock).mockResolvedValue('lw_external_copy_old');
      await service.tick();

      const order = (fn: unknown) => (fn as jest.Mock).mock.invocationCallOrder[0];

      // The old subscription is only disabled while the new copy is built: its tables stay readable and usable.
      expect(disableSubscription).toHaveBeenCalledWith(external);
      expect(deps.connectMembers).toHaveBeenCalledWith('10.93.0.1', 'loadweaver', { replication: true });
      expect(createSlotWithSnapshot).toHaveBeenCalledWith(
        membersDb,
        expect.stringMatching(/^lw_external_copy_[0-9a-f]{12}$/),
      );
      expect(copyMock).toHaveBeenCalledWith(membersDb, external, {
        snapshot: '00000003-1',
        tables: ['lw_nodes'],
        keepReadable: true,
      });
      expect(order(disableSubscription)).toBeLessThan(order(copyMock));
      expect(order(copyMock)).toBeLessThan(order(dropSubscription));
      expect(dropSlot).toHaveBeenCalledWith(membersDb, 'lw_external_copy_old');

      const slot = (createSlotWithSnapshot as jest.Mock).mock.calls[0][1];

      expect(createSubscription).toHaveBeenCalledWith(external, expect.any(String), {
        copyData: false,
        createSlot: false,
        slot,
        tables: ['lw_nodes'],
      });
      expect(service.status().externalCopy).toMatchObject({
        state: 'syncing',
        slot,
        leader: '10.93.0.1',
        slotHolders: ['10.93.0.1'],
        // The previous complete copy's time stays until the new one is confirmed.
        completeAt: '2026-10-31T10:00:00.000Z',
      });
    });

    it('re-copies when the new primary held no copy of the slot (Patroni created it afresh: changes would be missing)', async () => {
      const { service } = setup({ members, row: 'members', file, primary: '10.93.0.2' });

      previous({ leader: '10.93.0.1', slotHolders: ['10.93.0.1'] })(service);
      (externalCopyStatus as jest.Mock).mockResolvedValue(healthy);
      await service.tick();

      expect(createSlotWithSnapshot).toHaveBeenCalled();
      expect(createSubscription).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.objectContaining({ copyData: false, createSlot: false }),
      );
    });

    it('a failed re-copy drops its new slot, keeps the previous copy and repeats the decision next time', async () => {
      const { service, membersDb } = setup({ members, row: 'members', file, primary: '10.93.0.2' });

      previous({ leader: '10.93.0.1', slotHolders: ['10.93.0.1'] })(service);
      (externalCopyStatus as jest.Mock).mockResolvedValue(healthy);
      copyMock.mockRejectedValueOnce(new Error('canceling statement due to conflict with recovery'));
      await service.tick();

      const slot = (createSlotWithSnapshot as jest.Mock).mock.calls[0][1];

      expect(dropSlot).toHaveBeenCalledWith(membersDb, slot);
      expect(dropSubscription).not.toHaveBeenCalled();
      expect(createSubscription).not.toHaveBeenCalled();
      expect(service.status().externalCopy).toMatchObject({
        state: 'error',
        leader: '10.93.0.1',
        slotHolders: ['10.93.0.1'],
        completeAt: '2026-10-31T10:00:00.000Z',
      });

      await service.tick();
      expect(createSlotWithSnapshot).toHaveBeenCalledTimes(2);
    });

    it('enables a subscription an interrupted migrate step left disabled', async () => {
      const { service, external } = setup({ members, row: 'members', file });

      (externalCopyStatus as jest.Mock).mockResolvedValue({ ...healthy, enabled: false });
      await service.tick();

      expect(enableSubscription).toHaveBeenCalledWith(external);
      expect(createSlotWithSnapshot).not.toHaveBeenCalled();
    });
  });

  it('on a member / on-node install it only reads the epoch of its database for its agents', async () => {
    const { service, deps, dataSource } = setup({});

    databaseTarget.deployment = 'on-node';
    service.onApplicationBootstrap();
    service.onModuleDestroy();
    dataSource.query.mockImplementation((async (text: string) =>
      text.includes("'epoch' AS epoch")
        ? [{ epoch: '4', taken_over_at: null, postgres_scope: 'lw-abc-t3' }]
        : []) as never);
    await service.refreshMemberFence();
    expect(databaseTarget.databaseFence()).toEqual({ epoch: 4, scope: 'lw-abc-t3' });
    expect(service.status()).toMatchObject({ deployment: 'on-node', location: null, epoch: 4 });
    expect(deps.connectExternal).not.toHaveBeenCalled();
  });
});

describe('DatabaseHandoverService: fenced takeover by the built-in control plane (3.43, 2026-10-31)', () => {
  const MEMBERS_FILE = {
    target: 'members' as const,
    members: ['10.93.0.1'],
    caCertificatePem: CA,
    handoverId: 'h1',
    epoch: 1,
  };
  const NOW = 1_000_000;
  const usableCopy = (checkedAt = new Date(NOW - 150_000).toISOString()): [RegExp, unknown[]][] => [
    [/pg_subscription_rel/, [{ n: '0' }]],
    [/FROM pg_subscription s/, [{ oid: 7 }]],
    [/h\."external_copy"/, [{ state: 'members', external_copy: { state: 'ok', checkedAt }, epoch: '1' }]],
    [/FROM pg_class s/, [{ seq: 'lw_audit_seq', tbl: 'lw_audit', col: 'seq' }]],
  ];

  function readOnly(options: Parameters<typeof setup>[0], noPrimaryForMs: number) {
    const ctx = setup({ row: 'members', file: MEMBERS_FILE, primary: null, ...options });

    databaseTarget.fallback = true;
    databaseTarget.noPrimarySince = NOW - noPrimaryForMs;

    return ctx;
  }

  it('waits for the delay, then promotes a usable copy: subscription dropped, sequences, new epoch, restart', async () => {
    const waiting = readOnly({ externalResponses: usableCopy() }, 60_000);

    await waiting.service.tick();
    expect(waiting.deps.connectExternal).not.toHaveBeenCalled();
    expect(waiting.service.status().takeover).toMatchObject({ state: 'waiting', afterMs: 120_000 });

    const { service, deps, external, files } = readOnly({ externalResponses: usableCopy() }, 130_000);

    (dropSubscription as jest.Mock).mockResolvedValueOnce('lw_external_copy_abc');
    await service.tick();

    expect(dropSubscription).toHaveBeenCalledWith(external);
    expect(dropSlot).not.toHaveBeenCalled();
    expect(deps.migrate).toHaveBeenCalledWith('external');
    expect(external.sql.some((s) => s.startsWith('SELECT setval($1::regclass, GREATEST('))).toBe(true);
    expect(external.sql.some((s) => s.includes('"taken_over_at"') && s.includes('[2,'))).toBe(true);
    expect(files.at(-1)).toMatchObject({
      target: 'external',
      members: [],
      caCertificatePem: null,
      epoch: 2,
      takenOverAt: new Date(NOW).toISOString(),
      takeoverEpoch: 2,
      postgresScope: 'lw-abc-t2',
      pendingAudit: {
        action: 'control-plane.database-takeover',
        details: expect.objectContaining({ epoch: 2, previousEpoch: 1, slot: 'lw_external_copy_abc' }),
      },
    });
    expect(deps.restart).toHaveBeenCalledTimes(1);
    // Migrations before the row write (its epoch column), sequences before writes are taken.
    expect((deps.migrate as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (deps.writeFile as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it('stays read-only and says why when the copy is not usable', async () => {
    const stale = readOnly(
      { externalResponses: usableCopy(new Date(NOW - 130_000 - 10 * 60_000).toISOString()) },
      130_000,
    );

    await stale.service.tick();
    expect(dropSubscription).not.toHaveBeenCalled();
    expect(stale.files).toHaveLength(0);
    expect(stale.deps.restart).not.toHaveBeenCalled();
    expect(stale.service.status().takeover).toMatchObject({
      state: 'blocked',
      reason: expect.stringMatching(/last confirmed in sync/),
    });
    expect(stale.service.status().readOnlyReason).toMatch(/last confirmed in sync/);
    expect((await stale.service.inboxState()).takeoverBlocked).toMatch(/last confirmed in sync/);

    const noSubscription = readOnly({ externalResponses: [] }, 130_000);

    await noSubscription.service.tick();
    expect(noSubscription.service.status().takeover.reason).toMatch(/no subscription/);
  });

  it('stays read-only when the external database is unreachable or the takeover is off', async () => {
    const unreachable = readOnly({}, 130_000);

    unreachable.deps.connectExternal.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await unreachable.service.tick();
    expect(unreachable.service.status().takeover).toMatchObject({
      state: 'blocked',
      reason: expect.stringMatching(/external database is unreachable/),
    });

    const off = readOnly({ externalResponses: usableCopy() }, 10 * 60_000);

    off.service.env = { ...off.service.env, LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS: 'off' };
    await off.service.tick();
    expect(off.deps.connectExternal).not.toHaveBeenCalled();
    expect(off.service.status().takeover).toMatchObject({ state: 'off', afterMs: null });
  });

  it('does not take over when a member primary answers again meanwhile', async () => {
    const { service, deps, files } = readOnly({ externalResponses: usableCopy() }, 130_000);

    deps.findPrimary.mockResolvedValueOnce('10.93.0.1');
    await service.tick();
    expect(dropSubscription).not.toHaveBeenCalled();
    expect(files).toHaveLength(0);
  });

  it('after a takeover: fences a member primary of an older epoch (never dropped, never switched to)', async () => {
    const { service, deps, admin, membersDb, files } = setup({
      row: 'external',
      existingDatabase: true,
      file: { target: 'external', epoch: 2, takenOverAt: '2026-10-31T10:00:00.000Z', postgresScope: 'lw-abc-t2' },
    });

    membersDb.query.mockImplementation(async () => ({ rows: [{ state: 'members', epoch: 1 }] }));
    await service.tick();

    expect(admin.sql).toContain(`ALTER DATABASE "loadweaver" SET loadweaver.fenced_epoch = '2'`);
    expect(admin.sql).toContain(`ALTER DATABASE "loadweaver" SET loadweaver.fenced_at = '2026-10-31T10:00:00.000Z'`);
    expect(admin.sql).toContain(`ALTER DATABASE "loadweaver" SET loadweaver.fenced_scope = 'lw-abc-t2'`);
    expect(admin.sql).toContain('ALTER DATABASE "loadweaver" SET default_transaction_read_only = on');
    expect(admin.sql.some((s) => s.startsWith('DROP DATABASE'))).toBe(false);
    expect(copyMock).not.toHaveBeenCalled();
    expect(files).toHaveLength(0);
    expect(deps.restart).not.toHaveBeenCalled();
  });

  it('waits while several member primaries answer; hands over to a fresh one with the next epoch', async () => {
    const several = setup({
      row: 'external',
      primaries: ['10.93.0.1', '10.93.0.2'],
      file: { target: 'external', epoch: 2 },
    });

    await several.service.tick();
    expect(copyMock).not.toHaveBeenCalled();

    const fresh = setup({ row: 'external', file: { target: 'external', epoch: 2, postgresScope: 'lw-abc-t2' } });

    await fresh.service.tick();
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(fresh.membersDb.sql.some((s) => s.includes('"lw_database_handover"') && s.includes('["members"'))).toBe(
      true,
    );
    expect(fresh.membersDb.sql.some((s) => s.includes(',3]'))).toBe(true);
    expect(fresh.files.at(-1)).toMatchObject({ target: 'members', epoch: 3, postgresScope: 'lw-abc-t2' });
  });

  it('reports the takeover in the status and the inbox state while on the database it took over', async () => {
    const { service } = setup({
      row: 'external',
      primary: null,
      file: { target: 'external', epoch: 2, takenOverAt: '2026-10-31T10:00:00.000Z', postgresScope: 'lw-abc-t2' },
    });

    await service.tick();
    expect(service.status()).toMatchObject({
      epoch: 2,
      takenOverAt: '2026-10-31T10:00:00.000Z',
      postgresScope: 'lw-abc-t2',
      takeover: { state: 'taken-over' },
    });
    expect(await service.inboxState()).toMatchObject({ location: 'external', takenOverAt: '2026-10-31T10:00:00.000Z' });
  });

  it('stops reporting the takeover once a handover moved the database back to the members (3.43 live test)', async () => {
    const takenOver = { target: 'external' as const, epoch: 2, takenOverAt: '2026-10-31T10:00:00.000Z' };
    const fresh = setup({ row: 'external', file: { ...takenOver, takeoverEpoch: 2, postgresScope: 'lw-abc-t2' } });

    expect(fresh.service.status().takenOverAt).toBe('2026-10-31T10:00:00.000Z');
    await fresh.service.tick();
    expect(fresh.files.at(-1)).toMatchObject({ target: 'members', epoch: 3, takenOverAt: '2026-10-31T10:00:00.000Z' });
    expect(fresh.service.status()).toMatchObject({ location: 'members', epoch: 3, takenOverAt: null });
    expect(fresh.service.status().takeover.state).not.toBe('taken-over');
    // The members' fence info keeps the takeover (agents export the rows written after it).
    expect(fresh.service.runtime.databaseFence()).toMatchObject({ epoch: 3, takenOverAt: '2026-10-31T10:00:00.000Z' });

    // Back on the external database without a takeover (r = 0 return at epoch 3): not reported either.
    const returned = setup({ row: 'external', primary: null, file: { ...takenOver, epoch: 3, takeoverEpoch: 2 } });

    expect(returned.service.status()).toMatchObject({ location: 'external', takenOverAt: null });
    expect(await returned.service.inboxState()).toMatchObject({ takenOverAt: null });
  });
});
