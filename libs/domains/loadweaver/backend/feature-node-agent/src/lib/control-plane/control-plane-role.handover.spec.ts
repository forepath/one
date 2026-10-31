import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
  POSTGRES_CONNECT_CHANGED_EXIT,
  POSTGRES_ROLE_PASSWORDS_CHANGED_EXIT,
  POSTGRES_ROLE_PASSWORDS_COMMAND,
  POSTGRES_ROLE_PASSWORDS_REPLICA_EXIT,
  postgresConnectSyncCommand,
  postgresRolePasswordsExecEnvironment,
} from './control-plane-containers';
import {
  ControlPlaneRoleManager,
  PLATFORM_BACKUPS_GRACE_MS,
  POSTGRES_CONNECT_RECHECK_MS,
  POSTGRES_RELOAD_COMMAND,
} from './control-plane-role.manager';

const role = (members: ControlPlaneRole['members']): ControlPlaneRole =>
  ({ role: 'member', members, automaticFailover: false, scope: 'lw-test' }) as ControlPlaneRole;

function manager() {
  const m = new ControlPlaneRoleManager({} as never, {} as never, {} as never, {} as never);
  const switchover = jest.fn(async () => undefined);

  m.switchover = switchover as never;

  const handOver = (r: ControlPlaneRole) =>
    (m as unknown as { handOverIfDraining(n: string, a: string, r: ControlPlaneRole): void }).handOverIfDraining(
      'n2',
      '10.93.0.2',
      r,
    );

  return { m, switchover, handOver };
}

describe('ControlPlaneRoleManager: a draining member hands the Postgres leadership over (2026-10-26)', () => {
  it('switches over to a member that does not drain, once at a time', async () => {
    const { m, switchover, handOver } = manager();
    const draining = role([
      { name: 'n1', address: '10.93.0.1', witness: false },
      { name: 'n2', address: '10.93.0.2', witness: false, draining: true },
      { name: 'w', address: '10.93.0.9', witness: true },
    ]);

    handOver(draining);
    handOver(draining);
    await m.pendingHandover();
    expect(switchover).toHaveBeenCalledTimes(1);
    expect(switchover).toHaveBeenCalledWith('10.93.0.2', '10.93.0.1');
  });

  it('does nothing for a member that does not drain or when no other member can take over', async () => {
    const { switchover, handOver } = manager();

    handOver(
      role([
        { name: 'n1', address: '10.93.0.1', witness: false },
        { name: 'n2', address: '10.93.0.2', witness: false },
      ]),
    );
    handOver(
      role([
        { name: 'n1', address: '10.93.0.1', witness: false, draining: true },
        { name: 'n2', address: '10.93.0.2', witness: false, draining: true },
      ]),
    );
    expect(switchover).not.toHaveBeenCalled();
  });

  it('logs a failed switchover and tries again on the next reconcile', async () => {
    const { m, switchover, handOver } = manager();
    const draining = role([
      { name: 'n1', address: '10.93.0.1', witness: false },
      { name: 'n2', address: '10.93.0.2', witness: false, draining: true },
    ]);

    switchover.mockRejectedValueOnce(new Error('Patroni does not answer'));
    handOver(draining);
    await m.pendingHandover();
    handOver(draining);
    await m.pendingHandover();
    expect(switchover).toHaveBeenCalledTimes(2);
  });
});

describe('ControlPlaneRoleManager: steady platform-backup settings (G5: no double Postgres re-create on a join)', () => {
  const backups = { gatewayPort: 7480, bucket: 'lw-platform', region: 'garage' } as NonNullable<
    ControlPlaneRole['platformBackups']
  >;
  const steady = (m: ControlPlaneRoleManager, r: ControlPlaneRole) =>
    (m as unknown as { steadyPlatformBackups(r: ControlPlaneRole): ControlPlaneRole }).steadyPlatformBackups(r);
  const member = (withBackups: boolean): ControlPlaneRole =>
    ({
      ...role([{ name: 'n2', address: '10.93.0.2', witness: false }]),
      ...(withBackups ? { platformBackups: backups } : {}),
    }) as ControlPlaneRole;

  it('keeps the last settings over a short gap and drops them after the grace', () => {
    const { m } = manager();
    let now = 1_000_000;

    m.now = () => now;
    expect(steady(m, member(true)).platformBackups).toBe(backups);
    // A desired state without them (seconds later): the member keeps them, nothing is re-created.
    now += 5_000;
    expect(steady(m, member(false)).platformBackups).toBe(backups);
    // Back again: the gap is over.
    expect(steady(m, member(true)).platformBackups).toBe(backups);
    // Disabled for good: gone once the grace (2 min) has passed.
    now += 1_000;
    expect(steady(m, member(false)).platformBackups).toBe(backups);
    now += PLATFORM_BACKUPS_GRACE_MS;
    expect(steady(m, member(false)).platformBackups).toBeUndefined();
  });

  it('never keeps them for a node that is no member any more, nor invents them for a fresh member', () => {
    const { m } = manager();

    expect(steady(m, member(false)).platformBackups).toBeUndefined();
    steady(m, member(true));
    expect(steady(m, { ...member(false), role: 'none' } as ControlPlaneRole).platformBackups).toBeUndefined();
    expect(steady(m, member(false)).platformBackups).toBeUndefined();
  });
});

describe('ControlPlaneRoleManager: a new Postgres certificate is reloaded in place (2026-10-27)', () => {
  const reload = (containers: unknown) =>
    (
      new ControlPlaneRoleManager(containers as never, {} as never, {} as never, {} as never) as unknown as {
        reloadPostgres(): Promise<void>;
      }
    ).reloadPostgres();

  it('signals the postmaster as postgres inside the running container', async () => {
    const exec = jest.fn(async () => 0);

    await reload({ exec });
    expect(exec).toHaveBeenCalledWith('lw-postgres', POSTGRES_RELOAD_COMMAND, 'postgres');
    expect(POSTGRES_RELOAD_COMMAND.join(' ')).toContain('kill -HUP');
  });

  it('never fails the reconcile (Spilo reloads a changed certificate itself within 5 minutes)', async () => {
    await expect(reload({ exec: jest.fn(async () => 1) })).resolves.toBeUndefined();
    await expect(reload({ exec: jest.fn(async () => Promise.reject(new Error('gone'))) })).resolves.toBeUndefined();
  });
});

describe("ControlPlaneRoleManager: Patroni's connect addresses are the overlay address (3.43)", () => {
  function syncing(exec: jest.Mock) {
    const m = new ControlPlaneRoleManager({ exec } as never, {} as never, {} as never, {} as never);
    let now = 0;

    m.now = () => now;
    const sync = (address: string, started = false) =>
      (m as unknown as { syncPostgresConnect(a: string, s: boolean): Promise<void> }).syncPostgresConnect(
        address,
        started,
      );

    return { sync, advance: (ms: number) => (now += ms) };
  }

  it('sets them in the running Spilo once, then only after the re-check interval or a new address', async () => {
    const exec = jest.fn(async () => POSTGRES_CONNECT_CHANGED_EXIT);
    const { sync, advance } = syncing(exec);

    await sync('10.93.0.9');
    await sync('10.93.0.9');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(
      'lw-postgres',
      postgresConnectSyncCommand({ PG_CONNECT_ADDRESS: '10.93.0.9:5432', RESTAPI_CONNECT_ADDRESS: '10.93.0.9:8008' }),
      'postgres',
    );
    advance(POSTGRES_CONNECT_RECHECK_MS);
    await sync('10.93.0.9');
    await sync('10.93.0.1');
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it('skips loopback and a container that was just created with them, retries after a failure', async () => {
    const exec = jest.fn(async () => 1);
    const { sync } = syncing(exec);

    await sync('127.0.0.1');
    await sync('10.93.0.9', true);
    await sync('10.93.0.9');
    expect(exec).not.toHaveBeenCalled();

    const failing = syncing(exec);

    await failing.sync('10.93.0.9');
    await failing.sync('10.93.0.9');
    expect(exec).toHaveBeenCalledTimes(2);
    exec.mockRejectedValueOnce(new Error('gone'));
    await expect(failing.sync('10.93.0.9')).resolves.toBeUndefined();
  });

  it('passes the addresses as arguments to a script that only reloads Patroni when they changed', () => {
    const cmd = postgresConnectSyncCommand({
      PG_CONNECT_ADDRESS: '[fd00::1]:5432',
      RESTAPI_CONNECT_ADDRESS: '[fd00::1]:8008',
    });

    expect(cmd.slice(0, 2)).toEqual(['python3', '-c']);
    expect(cmd.slice(3)).toEqual(['[fd00::1]:5432', '[fd00::1]:8008']);
    expect(cmd[2]).toContain('/home/postgres/postgres.yml');
    expect(cmd[2]).toContain("'http://127.0.0.1:8008/reload', method='POST'");
    expect(cmd[2]).toContain(`sys.exit(${POSTGRES_CONNECT_CHANGED_EXIT})`);
  });
});

describe("ControlPlaneRoleManager: Spilo's standby / admin passwords follow the environment (2026-10-30)", () => {
  const withEnv = (environment: Record<string, string>): ControlPlaneRole =>
    ({ ...role([{ name: 'n1', address: '10.93.0.1', witness: false }]), environment }) as ControlPlaneRole;
  const passwords = {
    DB_USERNAME: 'lw',
    DB_PASSWORD: 'su',
    LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: 'repl',
    LOADWEAVER_POSTGRES_ADMIN_PASSWORD: 'adm',
  };

  function syncing(exec: jest.Mock) {
    const m = new ControlPlaneRoleManager({ exec } as never, {} as never, {} as never, {} as never);
    let now = 0;

    m.now = () => now;
    const sync = (r: ControlPlaneRole) =>
      (m as unknown as { syncPostgresRolePasswords(r: ControlPlaneRole): Promise<void> }).syncPostgresRolePasswords(r);

    return { sync, advance: (ms: number) => (now += ms) };
  }

  it('passes the passwords through the exec environment, never as arguments', () => {
    expect(postgresRolePasswordsExecEnvironment(withEnv(passwords))).toEqual({
      LW_ROLE_PASSWORD_STANDBY: 'repl',
      LW_ROLE_PASSWORD_ADMIN: 'adm',
      PGUSER: 'lw',
      PGPASSWORD: 'su',
    });
    expect(postgresRolePasswordsExecEnvironment(withEnv({ LOADWEAVER_POSTGRES_ADMIN_PASSWORD: 'adm' }))).toEqual({
      LW_ROLE_PASSWORD_ADMIN: 'adm',
      PGUSER: 'postgres',
      PGPASSWORD: '',
    });
    expect(postgresRolePasswordsExecEnvironment(withEnv({ DB_PASSWORD: 'su' }))).toEqual({});
  });

  it('runs in a session that does not log statements and sends only a SCRAM verifier', () => {
    const script = POSTGRES_ROLE_PASSWORDS_COMMAND[2];

    expect(POSTGRES_ROLE_PASSWORDS_COMMAND.slice(0, 2)).toEqual(['python3', '-c']);
    expect(script).toContain("log_statement = 'none'");
    expect(script).toContain("log_min_error_statement = 'panic'");
    expect(script).toContain('pg_is_in_recovery()');
    expect(script).toContain('sql.Literal(verifier)');
    expect(script).not.toMatch(/print\(/);
  });

  it('checks once per value, again after the re-check interval or for new values; a replica counts as checked', async () => {
    const exec = jest.fn(async () => POSTGRES_ROLE_PASSWORDS_CHANGED_EXIT);
    const { sync, advance } = syncing(exec);

    await sync(withEnv(passwords));
    await sync(withEnv(passwords));
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(
      'lw-postgres',
      POSTGRES_ROLE_PASSWORDS_COMMAND,
      'postgres',
      postgresRolePasswordsExecEnvironment(withEnv(passwords)),
    );
    await sync(withEnv({ ...passwords, LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: 'derived' }));
    expect(exec).toHaveBeenCalledTimes(2);
    advance(POSTGRES_CONNECT_RECHECK_MS);
    exec.mockResolvedValueOnce(POSTGRES_ROLE_PASSWORDS_REPLICA_EXIT);
    await sync(withEnv({ ...passwords, LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: 'derived' }));
    await sync(withEnv({ ...passwords, LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: 'derived' }));
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it('does nothing without passwords and retries after a failure without failing the reconcile', async () => {
    const exec = jest.fn(async () => 1);
    const { sync } = syncing(exec);

    await sync(withEnv({ DB_PASSWORD: 'su' }));
    expect(exec).not.toHaveBeenCalled();
    await sync(withEnv(passwords));
    await sync(withEnv(passwords));
    expect(exec).toHaveBeenCalledTimes(2);
    exec.mockRejectedValueOnce(new Error('gone'));
    await expect(sync(withEnv(passwords))).resolves.toBeUndefined();
  });
});
