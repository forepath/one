import { EventEmitter } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { guardClientErrors, liftDatabaseFreeze, type SqlClient } from './database-target.boot';
import {
  databaseTarget,
  DatabaseTargetClient,
  databaseWriteGuard,
  readDatabaseTargetFile,
  writeDatabaseTargetFile,
  writesPaused,
} from './database-target.runtime';
import { DATABASE_TARGET_FILENAME, FALLBACK_AFTER_MS, MEMBERS_UNREACHABLE_MESSAGE } from './database-handover.utils';
import { choosePrimary, MembersLeaderProxy } from './members-leader-proxy';

const external = {
  host: 'postgres',
  port: 5432,
  user: 'postgres',
  password: 'pw',
  database: 'loadweaver',
  ssl: false as const,
};

function params(client: DatabaseTargetClient): Record<string, unknown> {
  return (client as unknown as { connectionParameters: Record<string, unknown> }).connectionParameters;
}

afterEach(() => databaseTarget.reset());

describe('databaseWriteGuard (3.43)', () => {
  function run(method: string, block: string | null) {
    const res = { status: jest.fn(), setHeader: jest.fn(), json: jest.fn() };

    res.status.mockReturnValue(res);
    const next = jest.fn();

    databaseWriteGuard({ writeBlock: () => block })({ method }, res, next);

    return { res, next };
  }

  it('serves reads and lets writes through while nothing blocks', () => {
    expect(run('GET', 'blocked').next).toHaveBeenCalled();
    expect(run('POST', null).next).toHaveBeenCalled();
  });

  it('answers writes with 503 and the reason while blocked', () => {
    const { res, next } = run('PUT', "the cluster's database members are unreachable; read-only until one is back");

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '30');
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 503,
      error: 'Service Unavailable',
      code: 'read-only',
      message: "the cluster's database members are unreachable; read-only until one is back",
    });
  });

  it('carries a machine-readable code: freeze during a handover, read-only otherwise', () => {
    databaseTarget.freeze = 'handover';
    expect(databaseTarget.writeBlockCode()).toBe('freeze');
    databaseTarget.freeze = null;
    expect(databaseTarget.writeBlockCode()).toBeNull();
    databaseTarget.setFallback(true);
    expect(databaseTarget.writeBlockCode()).toBe('read-only');
    expect(databaseTarget.fallbackSince).toEqual(expect.any(Number));
    databaseTarget.setFallback(false);
    expect(databaseTarget.fallbackSince).toBeNull();

    const res = { status: jest.fn(), setHeader: jest.fn(), json: jest.fn() };

    res.status.mockReturnValue(res);
    databaseWriteGuard({ writeBlock: () => 'paused', writeBlockCode: () => 'freeze' })(
      { method: 'POST' },
      res,
      jest.fn(),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'freeze', message: 'paused' }));
  });

  it('reads the runtime: freeze and fallback', () => {
    databaseTarget.freeze = 'handover';
    expect(databaseTarget.writeBlock()).toMatch(/moving its database/);
    databaseTarget.freeze = null;
    databaseTarget.fallback = true;
    expect(databaseTarget.writeBlock()).toMatch(/read-only until one is back/);
  });
});

describe('DatabaseTargetClient: the pool client follows the fallback', () => {
  const config = { host: '127.0.0.1', port: 5433, user: 'postgres', password: 'pw', database: 'loadweaver' };

  it('keeps the password pg-pool hands over non-enumerable (live: SCRAM "client password must be a string")', () => {
    const pooled = { host: '127.0.0.1', port: 5432, user: 'postgres', database: 'loadweaver' };

    Object.defineProperty(pooled, 'password', { value: 'pw', enumerable: false });

    expect(params(new DatabaseTargetClient(pooled)).password).toBe('pw');
  });

  it('connects as configured normally', () => {
    databaseTarget.external = external;

    const client = new DatabaseTargetClient(config);

    expect(client.fallback).toBe(false);
    expect(params(client)).toMatchObject({ host: '127.0.0.1', port: 5433 });
  });

  it('connects to the external copy with read-only sessions during the fallback', () => {
    databaseTarget.external = external;
    databaseTarget.fallback = true;

    const client = new DatabaseTargetClient(config);

    expect(client.fallback).toBe(true);
    expect(params(client)).toMatchObject({
      host: 'postgres',
      port: 5432,
      options: '-c default_transaction_read_only=on',
    });
  });

  it('cuts the connections of the other side when the fallback changes', () => {
    databaseTarget.external = external;

    const normal = new DatabaseTargetClient(config);
    const cut = jest.spyOn(normal, 'cut').mockImplementation(() => undefined);

    databaseTarget.setFallback(true);
    expect(cut).toHaveBeenCalledTimes(1);

    const fallback = new DatabaseTargetClient(config);
    const cutFallback = jest.spyOn(fallback, 'cut').mockImplementation(() => undefined);

    databaseTarget.setFallback(true);
    expect(cutFallback).not.toHaveBeenCalled();
    databaseTarget.setFallback(false);
    expect(cutFallback).toHaveBeenCalledTimes(1);
  });

  it('without an external database (on-node, tests) it never falls back', () => {
    databaseTarget.fallback = true;
    expect(new DatabaseTargetClient(config).fallback).toBe(false);
  });
});

describe('target file on the state volume', () => {
  let dir: string;

  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'lw-db-target-'))));
  afterEach(async () => await rm(dir, { recursive: true, force: true }));

  it('round-trips, written 0600', async () => {
    expect(await readDatabaseTargetFile(dir)).toBeNull();

    const file = {
      version: 1 as const,
      target: 'members' as const,
      members: ['10.93.0.1'],
      caCertificatePem: '-----BEGIN CERTIFICATE-----',
      handoverId: 'h1',
      updatedAt: '2026-10-30T00:00:00.000Z',
      pendingAudit: null,
    };

    await writeDatabaseTargetFile(dir, file);
    expect(await readDatabaseTargetFile(dir)).toEqual({
      ...file,
      epoch: 0,
      takenOverAt: null,
      takeoverEpoch: null,
      postgresScope: null,
    });
    expect((await stat(join(dir, DATABASE_TARGET_FILENAME))).mode & 0o777).toBe(0o600);
  });
});

describe('liftDatabaseFreeze', () => {
  function fake(setconfig: string[] | null): SqlClient & { sql: string[] } {
    const sql: string[] = [];

    return {
      sql,
      query: async (text: string) => {
        sql.push(text);

        return { rows: text.includes('pg_db_role_setting') && setconfig ? [{ setconfig }] : [] } as never;
      },
    };
  }

  it('resets a leftover database-level read-only setting', async () => {
    const client = fake(['default_transaction_read_only=on', 'work_mem=4MB']);

    expect(await liftDatabaseFreeze(client, 'loadweaver')).toBe(true);
    expect(client.sql.slice(1)).toEqual([
      'SET default_transaction_read_only = off',
      'ALTER DATABASE "loadweaver" RESET default_transaction_read_only',
    ]);
  });

  it('leaves a database without the setting alone', async () => {
    const client = fake(['work_mem=4MB']);

    expect(await liftDatabaseFreeze(client, 'loadweaver')).toBe(false);
    expect(client.sql).toHaveLength(1);
  });
});

describe('MembersLeaderProxy polls drive the fallback', () => {
  it('keeps a working leader and its connections over a missed poll; a different primary replaces them (live 3.43)', async () => {
    let primary: string | null = '10.93.0.1';
    const proxy = new MembersLeaderProxy(
      ['10.93.0.1', '10.93.0.2'],
      0,
      async () => (primary ? [primary] : []),
      () => 0,
    );
    const internals = proxy as unknown as { leader: string | null; connections: Set<{ destroy: () => void }> };
    const connection = { destroy: jest.fn() };

    await proxy.poll();
    internals.connections.add(connection);

    primary = null;
    await proxy.poll();
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(internals.leader).toBe('10.93.0.1');

    primary = '10.93.0.2';
    await proxy.poll();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(internals.leader).toBe('10.93.0.2');
  });

  it('refuses writes (503) after two polls without a primary, before the fallback starts (live 3.43: 500s for ~45 s)', async () => {
    let now = 0;
    let primary: string | null = '10.93.0.1';
    const proxy = new MembersLeaderProxy(
      ['10.93.0.1'],
      0,
      async () => (primary ? [primary] : []),
      () => now,
      async () => true,
    );

    await proxy.poll();
    primary = null;
    now += 2_000;
    await proxy.poll();
    // One slow answer is no outage.
    expect(databaseTarget.writeBlock()).toBeNull();
    now += 2_000;
    await proxy.poll();
    expect(databaseTarget.leaderMissing).toBe(true);
    expect(databaseTarget.fallback).toBe(false);
    expect(databaseTarget.writeBlock()).toBe(MEMBERS_UNREACHABLE_MESSAGE);
    // The fallback takes over (same message), and a primary again lifts both.
    now += 45_000;
    await proxy.poll();
    expect(databaseTarget.fallback).toBe(true);
    expect(databaseTarget.leaderMissing).toBe(false);
    expect(databaseTarget.writeBlock()).toBe(MEMBERS_UNREACHABLE_MESSAGE);
    primary = '10.93.0.1';

    for (let i = 0; i < 3; i++) await proxy.poll();

    expect(databaseTarget.writeBlock()).toBeNull();
  });

  it('lifts the write refusal as soon as the primary answers again (no fallback yet)', async () => {
    let primary: string | null = '10.93.0.1';
    const proxy = new MembersLeaderProxy(
      ['10.93.0.1'],
      0,
      async () => (primary ? [primary] : []),
      () => 0,
      async () => true,
    );

    await proxy.poll();
    primary = null;
    await proxy.poll();
    await proxy.poll();
    expect(databaseTarget.leaderMissing).toBe(true);
    primary = '10.93.0.1';
    await proxy.poll();
    expect(databaseTarget.writeBlock()).toBeNull();
  });

  it('falls back at once on a start without members, and back after the primary is steady', async () => {
    let now = 0;
    let primary: string | null = null;
    const proxy = new MembersLeaderProxy(
      ['10.93.0.1'],
      0,
      async () => (primary ? [primary] : []),
      () => now,
    );

    await proxy.poll();
    expect(databaseTarget.fallback).toBe(true);

    primary = '10.93.0.1';
    await proxy.poll();
    await proxy.poll();
    expect(databaseTarget.fallback).toBe(true);
    await proxy.poll();
    expect(databaseTarget.fallback).toBe(false);

    // Reached once: a short leader gap (a Patroni failover) is no outage.
    primary = null;
    now = 1_000;
    await proxy.poll();
    expect(databaseTarget.fallback).toBe(false);
    now = 1_000 + FALLBACK_AFTER_MS;
    await proxy.poll();
    expect(databaseTarget.fallback).toBe(true);
  });
});

describe('MembersLeaderProxy with several primaries (3.43 takeover: a returning member leads its old scope)', () => {
  it('keeps the current leader while it answers and records since when no primary answered', async () => {
    let now = 0;
    let primaries: string[] = ['10.93.0.2'];
    const proxy = new MembersLeaderProxy(
      ['10.93.0.1', '10.93.0.2'],
      0,
      async () => primaries,
      () => now,
      async () => true,
    );

    await proxy.poll();
    expect(proxy.currentLeader()).toBe('10.93.0.2');
    expect(databaseTarget.noPrimarySince).toBeNull();
    // A second (older) primary earlier in address order doesn't replace a working leader.
    primaries = ['10.93.0.1', '10.93.0.2'];
    await proxy.poll();
    expect(proxy.currentLeader()).toBe('10.93.0.2');
    primaries = [];
    now = 5_000;
    await proxy.poll();
    expect(databaseTarget.noPrimarySince).toBe(5_000);
    now = 7_000;
    await proxy.poll();
    expect(databaseTarget.noPrimarySince).toBe(5_000);
  });

  it('choosePrimary: the current one if listed, else the first', () => {
    expect(choosePrimary(['a', 'b'], 'b')).toBe('b');
    expect(choosePrimary(['a', 'b'], 'c')).toBe('a');
    expect(choosePrimary([], 'c')).toBeNull();
  });
});

describe('DatabaseTargetRuntime.databaseFence (3.43 takeover)', () => {
  it('external: from the target file; on-node: from the member database; disabled: none', () => {
    databaseTarget.deployment = 'external';
    databaseTarget.file = {
      version: 1,
      target: 'external',
      members: [],
      caCertificatePem: null,
      handoverId: null,
      updatedAt: '',
      epoch: 3,
      takenOverAt: '2026-10-31T10:00:00.000Z',
      postgresScope: 'lw-abc-t3',
    };
    expect(databaseTarget.databaseFence()).toEqual({
      epoch: 3,
      takenOverAt: '2026-10-31T10:00:00.000Z',
      scope: 'lw-abc-t3',
    });
    databaseTarget.file = null;
    expect(databaseTarget.databaseFence()).toEqual({ epoch: 0 });
    databaseTarget.deployment = 'on-node';
    expect(databaseTarget.databaseFence()).toBeNull();
    databaseTarget.memberFence = { epoch: 2 };
    expect(databaseTarget.databaseFence()).toEqual({ epoch: 2 });
    databaseTarget.deployment = 'disabled';
    expect(databaseTarget.databaseFence()).toBeNull();
  });
});

describe('guardClientErrors (live 3.43: a members restart ended the process)', () => {
  it('keeps an idle client error from becoming an uncaught exception', () => {
    const client = guardClientErrors(new EventEmitter());

    expect(() => client.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
  });

  it('without it the same error throws', () => {
    expect(() => new EventEmitter().emit('error', new Error('x'))).toThrow('x');
  });
});

describe('writesPaused: write-only background jobs while the database is read-only (3.43)', () => {
  function logger() {
    return { log: jest.fn(), debug: jest.fn() };
  }

  it('runs normally while nothing blocks writes, without logging', () => {
    const log = logger();

    expect(writesPaused('vm-commands', log)).toBe(false);
    expect(log.log).not.toHaveBeenCalled();
    expect(log.debug).not.toHaveBeenCalled();
  });

  it('pauses during the fallback, a freeze or a missing primary; logs entering and leaving once per job', () => {
    const vm = logger();
    const git = logger();

    databaseTarget.setFallback(true);
    expect(writesPaused('vm-commands', vm)).toBe(true);
    expect(writesPaused('vm-commands', vm)).toBe(true);
    expect(writesPaused('git-sync', git)).toBe(true);
    expect(vm.log).toHaveBeenCalledTimes(1);
    expect(vm.log.mock.calls[0][0]).toBe(
      "vm-commands: paused while the cluster database can't take writes (read-only fallback)",
    );
    expect(vm.debug).toHaveBeenCalledWith('vm-commands: skipped (read-only fallback)');
    expect(git.log).toHaveBeenCalledTimes(1);

    databaseTarget.setFallback(false);
    expect(writesPaused('vm-commands', vm)).toBe(false);
    expect(vm.log).toHaveBeenLastCalledWith('vm-commands: resumed, the cluster database takes writes again');
    expect(writesPaused('vm-commands', vm)).toBe(false);
    expect(vm.log).toHaveBeenCalledTimes(2);

    databaseTarget.freeze = 'handover';
    expect(writesPaused('vm-commands', vm)).toBe(true);
    expect(vm.log).toHaveBeenLastCalledWith(
      "vm-commands: paused while the cluster database can't take writes (handover freeze: handover)",
    );
    databaseTarget.freeze = null;
    databaseTarget.leaderMissing = true;
    // Still paused (another reason): no second "paused" line.
    expect(writesPaused('vm-commands', vm)).toBe(true);
    expect(vm.log).toHaveBeenCalledTimes(3);
  });

  it('works without a logger', () => {
    databaseTarget.setFallback(true);
    expect(writesPaused('usage')).toBe(true);
  });
});
