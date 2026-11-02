import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';

import { ControlPlaneRoleManager } from './control-plane-role.manager';
import {
  divergedDirName,
  FENCE_EXPORT_COMMAND,
  FENCE_PROBE_COMMAND,
  FENCE_PROBE_FILE,
  fenceDatabase,
  fenceDecision,
  fencedDataDirName,
  fenceExecEnvironment,
  parseFenceProbe,
  parseFenceState,
  probeDatabaseFence,
  readFenceState,
  recentFenceReport,
  seenEpoch,
  staleRole,
  writeFenceState,
  type FenceDeps,
  type FenceProbe,
} from './database-fence';
import { readScopeMarker } from './postgres-cutover';

const probe = (patch: Partial<FenceProbe> = {}): FenceProbe => ({
  recovery: false,
  database: true,
  epoch: 1,
  fencedEpoch: null,
  fencedAt: null,
  fencedScope: null,
  ...patch,
});
const role = (patch: Partial<ControlPlaneRole> = {}): ControlPlaneRole =>
  ({
    role: 'member',
    members: [{ name: 'n1', address: '10.93.0.1', witness: false }],
    automaticFailover: false,
    scope: 'lw-abc',
    environment: { DB_DATABASE: 'loadweaver', DB_USERNAME: 'su', DB_PASSWORD: 'pw' },
    ...patch,
  }) as ControlPlaneRole;

describe('database fencing decisions (3.43 takeover)', () => {
  it('parses the probe and the persisted state defensively', () => {
    expect(parseFenceProbe(null)).toBeNull();
    expect(parseFenceProbe('{')).toBeNull();
    expect(parseFenceProbe('{"database":"yes"}')).toBeNull();
    expect(
      parseFenceProbe(
        JSON.stringify({
          recovery: true,
          database: true,
          epoch: 1,
          fencedEpoch: 2,
          fencedAt: 't',
          fencedScope: 'lw-abc-t2',
        }),
      ),
    ).toEqual({ recovery: true, database: true, epoch: 1, fencedEpoch: 2, fencedAt: 't', fencedScope: 'lw-abc-t2' });
    expect(parseFenceProbe(JSON.stringify({ database: true, epoch: -1, fencedScope: 'Bad' }))).toMatchObject({
      epoch: null,
      fencedScope: null,
    });
    expect(parseFenceState(null)).toEqual({ seenEpoch: 0, lastReport: null });
    expect(parseFenceState('{"seenEpoch":3}')).toEqual({ seenEpoch: 3, lastReport: null });
  });

  it('the seen epoch only grows; a role below it is stale', () => {
    expect(seenEpoch(1, role({ databaseFence: { epoch: 3 } }), null)).toBe(3);
    expect(seenEpoch(4, role({ databaseFence: { epoch: 3 } }), probe({ fencedEpoch: 2 }))).toBe(4);
    expect(seenEpoch(0, role(), probe({ fencedEpoch: 2 }))).toBe(2);
    expect(staleRole(role({ databaseFence: { epoch: 1 } }), 2)).toBe(true);
    expect(staleRole(role({ databaseFence: { epoch: 2 } }), 2)).toBe(false);
    // Older control planes send no epoch: applied as before.
    expect(staleRole(role(), 2)).toBe(false);
  });

  it('fences data older than the seen epoch, with the scope / takeover time of a current role', () => {
    const current = role({ databaseFence: { epoch: 2, takenOverAt: '2026-10-31T10:00:00.000Z', scope: 'lw-abc-t2' } });

    expect(fenceDecision({ probe: probe({ epoch: 1 }), seen: 2, role: current })).toEqual({
      kind: 'fence',
      epoch: 2,
      dataEpoch: 1,
      takenOverAt: '2026-10-31T10:00:00.000Z',
      scope: 'lw-abc-t2',
    });
    expect(fenceDecision({ probe: probe({ epoch: 2 }), seen: 2, role: current })).toEqual({ kind: 'none' });
    // No database / no row (a fresh member, a handover in progress), Postgres not asked: nothing.
    expect(fenceDecision({ probe: probe({ database: false }), seen: 2, role: current })).toEqual({ kind: 'none' });
    expect(fenceDecision({ probe: probe({ epoch: null }), seen: 2, role: current })).toEqual({ kind: 'none' });
    expect(fenceDecision({ probe: null, seen: 2, role: current })).toEqual({ kind: 'none' });
  });

  it('with a stale role: only the fence settings the control plane wrote count, never its database scope', () => {
    const stale = role({ databaseFence: { epoch: 1 }, postgresScope: 'lw-abc' });

    expect(
      fenceDecision({
        probe: probe({ epoch: 1, fencedEpoch: 2, fencedAt: '2026-10-31T10:00:00.000Z', fencedScope: 'lw-abc-t2' }),
        seen: 2,
        role: stale,
      }),
    ).toMatchObject({ kind: 'fence', scope: 'lw-abc-t2', takenOverAt: '2026-10-31T10:00:00.000Z' });
    expect(fenceDecision({ probe: probe({ epoch: 1 }), seen: 2, role: stale })).toMatchObject({ kind: 'refuse' });
  });

  it('names: data next to it, export in the state directory, timestamped', () => {
    const at = new Date('2026-10-31T12:34:56.789Z');

    expect(fencedDataDirName(1, at)).toBe('postgres.fenced-e1-20261031T123456Z');
    expect(divergedDirName(at)).toBe('database-diverged-20261031T123456Z');
  });

  it('scripts: python in Spilo, secrets only in the exec environment', () => {
    expect(FENCE_PROBE_COMMAND.slice(0, 2)).toEqual(['python3', '-c']);
    expect(FENCE_EXPORT_COMMAND[2]).toContain("'created_at', 'updated_at', 'time'");
    expect(FENCE_EXPORT_COMMAND[2]).toContain('row_to_json');
    expect(FENCE_EXPORT_COMMAND.join(' ')).not.toContain('pw');
    expect(fenceExecEnvironment(role(), { LW_SINCE: 't' })).toEqual({
      LW_DATABASE: 'loadweaver',
      PGUSER: 'su',
      PGPASSWORD: 'pw',
      LW_SINCE: 't',
    });
  });
});

describe('fencing on disk', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-fence-'));
    await mkdir(join(dir, 'postgres', 'pgroot', 'data'), { recursive: true });
    await writeFile(join(dir, 'postgres', 'pgroot', 'data', 'PG_VERSION'), '17\n');
  });
  afterEach(async () => await rm(dir, { recursive: true, force: true }));

  function deps(exec: FenceDeps['exec']): FenceDeps & { removed: string[]; lines: string[] } {
    const removed: string[] = [];
    const lines: string[] = [];

    return {
      stateDir: dir,
      exec,
      removeContainer: async (name) => {
        removed.push(name);

        return true;
      },
      ownBySpilo: async () => undefined,
      log: (line) => lines.push(line),
      now: () => new Date('2026-10-31T12:00:00.000Z'),
      removed,
      lines,
    };
  }

  it('probe: runs the script with the output path in the data volume and reads it back', async () => {
    const exec = jest.fn(async (_cmd: string[], env: Record<string, string>) => {
      expect(env['LW_OUT']).toBe(`/home/postgres/pgdata/${FENCE_PROBE_FILE}`);
      await writeFile(join(dir, 'postgres', FENCE_PROBE_FILE), JSON.stringify({ database: true, epoch: 1 }));

      return 0;
    });

    expect(await probeDatabaseFence(deps(exec), role())).toMatchObject({ database: true, epoch: 1 });
    expect(await readdir(join(dir, 'postgres'))).not.toContain(FENCE_PROBE_FILE);
    expect(
      await probeDatabaseFence(
        deps(async () => 1),
        role(),
      ),
    ).toBeNull();
    expect(
      await probeDatabaseFence(
        deps(async () => {
          throw new Error('no such container');
        }),
        role(),
      ),
    ).toBeNull();
  });

  it('fence: API stopped, export moved out, data moved aside (kept), empty directory, new scope', async () => {
    const order: string[] = [];
    const d = deps(async (_cmd, env) => {
      order.push('export');
      expect(env['LW_SINCE']).toBe('2026-10-31T10:00:00.000Z');
      const out = join(dir, 'postgres', env['LW_OUT_DIR'].split('/').pop() as string);

      await mkdir(out, { recursive: true });
      await writeFile(join(out, 'lw_audit.ndjson'), '{"seq":1}\n{"seq":2}\n');
      await writeFile(join(out, 'manifest.json'), JSON.stringify({ tables: { lw_audit: { rows: 2 } } }));

      return 0;
    });
    const remove = d.removeContainer;

    d.removeContainer = async (name) => {
      order.push(`remove ${name}`);

      return await remove(name);
    };

    const report = await fenceDatabase(
      d,
      role(),
      { kind: 'fence', epoch: 2, dataEpoch: 1, takenOverAt: '2026-10-31T10:00:00.000Z', scope: 'lw-abc-t2' },
      { api: 'lw-control-plane', postgres: 'lw-postgres' },
    );

    expect(order).toEqual(['remove lw-control-plane', 'export', 'remove lw-postgres']);
    expect(report).toMatchObject({
      epoch: 2,
      dataEpoch: 1,
      at: '2026-10-31T12:00:00.000Z',
      dataDir: join(dir, 'postgres.fenced-e1-20261031T120000Z'),
      exportDir: join(dir, 'database-diverged-20261031T120000Z'),
      exportRows: 2,
    });
    expect(report.exportBytes).toBeGreaterThan(0);
    expect(
      await readFile(join(dir, 'postgres.fenced-e1-20261031T120000Z', 'pgroot', 'data', 'PG_VERSION'), 'utf8'),
    ).toBe('17\n');
    expect(await readdir(join(dir, 'postgres'))).toEqual([]);
    expect(await readScopeMarker(dir)).toBe('lw-abc-t2');
  });

  it('a failed export keeps everything in the moved-aside directory and says so', async () => {
    const report = await fenceDatabase(
      deps(async () => 1),
      role(),
      { kind: 'fence', epoch: 2, dataEpoch: 1, takenOverAt: '2026-10-31T10:00:00.000Z', scope: 'lw-abc-t2' },
      { api: 'lw-control-plane', postgres: 'lw-postgres' },
    );

    expect(report.exportDir).toBeUndefined();
    expect(report.exportError).toMatch(/export failed \(exit 1\)/);
    expect(await readdir(dir)).toEqual(expect.arrayContaining(['postgres', 'postgres.fenced-e1-20261031T120000Z']));

    const unknown = await fenceDatabase(
      deps(jest.fn()),
      role(),
      { kind: 'fence', epoch: 3, dataEpoch: 2, takenOverAt: null, scope: 'lw-abc-t3' },
      { api: 'a', postgres: 'p' },
    );

    expect(unknown.exportError).toBe('the takeover time is unknown');
  });

  it('state file round-trip and the report for the heartbeat (a week)', async () => {
    const report = { epoch: 2, dataEpoch: 1, at: '2026-10-31T12:00:00.000Z', dataDir: '/d' };

    await writeFenceState(dir, { seenEpoch: 2, lastReport: report });
    expect(await readFenceState(dir)).toEqual({ seenEpoch: 2, lastReport: report });
    expect(await recentFenceReport(dir, Date.parse('2026-11-01T00:00:00Z'))).toEqual(report);
    expect(await recentFenceReport(dir, Date.parse('2026-11-08T00:00:00Z'))).toBeNull();
  });
});

describe('ControlPlaneRoleManager: fencing (3.43 takeover)', () => {
  let dir: string;

  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'lw-fence-mgr-'))));
  afterEach(async () => await rm(dir, { recursive: true, force: true }));

  function manager(exec: jest.Mock = jest.fn(async () => 1)) {
    const containers = { exec, remove: jest.fn(async () => true), ensure: jest.fn(async () => true) };
    const m = new ControlPlaneRoleManager(
      containers as never,
      { dir } as never,
      { stop: jest.fn() } as never,
      {} as never,
    );

    return { m, containers };
  }

  it('ignores a role of an older epoch than seen: nothing started or removed', async () => {
    await writeFenceState(dir, { seenEpoch: 3, lastReport: null });

    const { m, containers } = manager();

    expect(await m.apply('n1', '10.93.0.1', role({ role: 'witness', databaseFence: { epoch: 2 } }))).toBe(false);
    expect(containers.remove).not.toHaveBeenCalled();
    expect(containers.ensure).not.toHaveBeenCalled();
  });

  it('persists a higher epoch from the role', async () => {
    const { m } = manager();

    await m.apply('n1', '10.93.0.1', role({ role: 'none', databaseFence: { epoch: 4 } }));
    expect((await readFenceState(dir)).seenEpoch).toBe(4);
  });

  it('fences when the probe finds older data, persists the report, and skips current data', async () => {
    await mkdir(join(dir, 'postgres'), { recursive: true });

    let found = {
      database: true,
      epoch: 1,
      fencedEpoch: 2,
      fencedAt: '2026-10-31T10:00:00.000Z',
      fencedScope: 'lw-abc-t2',
    };
    const exec = jest.fn(async (_name: string, cmd: string[]) => {
      if (cmd === FENCE_PROBE_COMMAND) {
        await writeFile(join(dir, 'postgres', FENCE_PROBE_FILE), JSON.stringify(found));

        return 0;
      }

      return 1;
    });
    const { m, containers } = manager(exec);
    const fenceWith = (r: ControlPlaneRole, p: FenceProbe | null) =>
      (m as unknown as { fenceWith(r: ControlPlaneRole, p: FenceProbe | null): Promise<boolean> }).fenceWith(r, p);

    expect(await fenceWith(role(), probe({ epoch: 2 }))).toBe(false);
    expect(containers.remove).not.toHaveBeenCalled();

    // Between applies: the control plane wrote the fence settings into this (old) primary.
    (m as unknown as { lastMemberApply: unknown }).lastMemberApply = {
      nodeName: 'n1',
      address: '10.93.0.1',
      role: role({ role: 'witness' }),
    };
    await m.periodicFenceCheck();
    expect(containers.remove).toHaveBeenCalledWith('lw-control-plane');
    expect(containers.remove).toHaveBeenCalledWith('lw-postgres');
    expect(await readScopeMarker(dir)).toBe('lw-abc-t2');

    const state = await readFenceState(dir);

    expect(state.seenEpoch).toBe(2);
    expect(state.lastReport).toMatchObject({
      epoch: 2,
      dataEpoch: 1,
      exportError: expect.stringMatching(/export failed/),
    });
    expect((await readdir(dir)).some((e) => e.startsWith('postgres.fenced-e1-'))).toBe(true);

    found = { ...found, epoch: 2 };
    containers.remove.mockClear();
    await m.periodicFenceCheck();
    expect(containers.remove).not.toHaveBeenCalledWith('lw-postgres');
  });
});
