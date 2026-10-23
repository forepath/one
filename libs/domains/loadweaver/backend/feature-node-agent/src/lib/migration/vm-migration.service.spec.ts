import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decodeAgentMessage,
  type Envelope,
  type MigrationProgress,
  type WorkloadSpec,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import type Docker from 'dockerode';

import type { BackupJobs, JobOutput } from '../backups/backup-jobs';
import type { CommandRunner } from '../host/command-runner';
import type { LiveSessionsService } from '../live/live-sessions.service';
import { openTree, passTarFile, readPassTar, scanPass, type GuestSyncOps } from '../microvm/guest-sync';
import type { GuestVolumes } from '../microvm/guest-volumes';
import { replicaPaths, vmrootConfig } from '../microvm/rootfs-cache';
import { readTar } from '../microvm/rootfs-unpack';
import type { AgentStateStore } from '../state/agent-state.store';
import type { VmSupport } from '../vm/vm-support.service';
import type { VolumeManager } from '../volumes/volume.manager';
import { microvmRunDir } from '../workloads/workload-container';
import type { WorkloadManager } from '../workloads/workload.manager';
import { MigrationSessions } from './migration-sessions';
import type { RelayTarget, TransferService } from './transfer.service';
import {
  guestMountPoints,
  HANDOVER_BATCH,
  INCOMING_MARKER,
  launcherIncomingSocket,
  launcherLibvirtSocket,
  parseDomJobInfo,
  parseQueryMigrate,
  PEER_SOCKET_IN_LAUNCHER,
  VM_CTL,
  VmMigrationService,
} from './vm-migration.service';

const MIGRATION = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
const TOKEN = 'A'.repeat(43);
const REPLICA = 'p1/lw-vm/db1/0';
const DISK = 'p1/lw-vm/db1.root';
const ENDPOINT = { address: '10.93.0.2', port: 7460 };

const JOBINFO = `Job type:         Unbounded
Operation:        Outgoing migration
Time elapsed:     2042         ms
Data processed:   1.500 GiB
Data remaining:   12.000 MiB
Data total:       4.008 GiB
Memory processed: 1.500 GiB
Dirty rate:       2000         pages/s
Page size:        4096         bytes
Iteration:        3
Expected downtime: 211          ms
`;
const COMPLETED = `Job type:         Completed
Operation:        Outgoing migration
Time elapsed:     5210         ms
Data processed:   4.100 GiB
Total downtime:   187          ms
`;

const DATA = 'p1/web/data';
const spec = (vm = true, mode: 'generic' | 'bundled' = 'generic'): WorkloadSpec =>
  ({
    id: REPLICA,
    specHash: 'b'.repeat(32),
    image: 'launcher',
    addresses: ['10.88.1.10'],
    volumes: vm ? [] : [{ type: 'volume', volume: DATA, target: '/data', readOnly: false }],
    ...(vm
      ? {
          vm: {
            disks: [{ name: 'root', volume: DISK, bus: 'virtio', cache: 'none', boot: true }],
            nics: [{ name: 'eth0', mac: '52:54:00:00:00:01', addresses: ['10.88.1.10'] }],
          },
        }
      : { microvm: { mode } }),
  }) as unknown as WorkloadSpec;

/** QMP `query-migrate` as `virsh qemu-monitor-command` prints it. */
const qmp = (status: string, ram: Record<string, number> = {}, extra: Record<string, unknown> = {}) =>
  ok(JSON.stringify({ return: { status, ram, ...extra }, id: 'libvirt-7' }));

const ok = (stdout = ''): JobOutput => ({ exitCode: 0, stdout, stderr: '', combined: stdout });

function setup(
  options: {
    exec?: (args: string[]) => JobOutput | Promise<JobOutput>;
    container?: Partial<Docker.ContainerInfo> | null;
    generic?: boolean;
    /** Bundled microVMs (M7 F5): the launcher's inspect data. */
    bundled?: { env?: string[]; mounts?: string[]; upper?: string; volumes?: WorkloadSpec['volumes'] };
  } = {},
) {
  const sent: MigrationProgress[] = [];
  const execs: string[][] = [];
  const updates: unknown[] = [];
  const relays: { close: jest.Mock; gate: jest.Mock; release: jest.Mock }[] = [];
  const order: string[] = [];
  const container = options.container === null ? undefined : { Id: 'c1', State: 'running', ...options.container };
  let killed = false;
  const docker = {
    getContainer: () => ({
      inspect: async () => ({
        Name: '/lw-launcher',
        State: { Pid: 4242, Running: !killed },
        HostConfig: { RestartPolicy: { Name: 'always' } },
        Config: { Env: options.bundled?.env ?? [] },
        Mounts: (options.bundled?.mounts ?? []).map((Destination) => ({ Destination })),
        ...(options.bundled?.upper ? { GraphDriver: { Data: { UpperDir: options.bundled.upper } } } : {}),
      }),
      update: async (u: unknown) => void updates.push(u),
      kill: async () => {
        killed = true;
        order.push('kill');
      },
    }),
  } as unknown as Docker;
  const state = {
    identity: async () => ({ clusterId: 'lab', nodeName: 'n2' }),
    credentials: async () => ({ privateKeyPem: 'k', certificatePem: 'c', caCertificatePem: 'ca' }),
    appliedState: async () => ({
      network: { addresses: ['10.93.0.2'], wireguard: [{ peer: 'n1', peerAddresses: ['10.93.0.1'] }] },
    }),
  } as unknown as AgentStateStore;
  const commands = { run: jest.fn(async () => ({ stdout: '', stderr: '' })) } as unknown as CommandRunner;
  const workloads = {
    createReplica: jest.fn(async () => undefined),
    containerOf: jest.fn(async () => container),
    specOf: jest.fn(() =>
      options.bundled
        ? {
            ...spec(false, 'bundled'),
            ...(options.bundled.volumes ? { volumes: options.bundled.volumes } : {}),
          }
        : spec(!options.generic),
    ),
    removeContainer: jest.fn(async () => undefined),
    expectIncoming: jest.fn(),
    incomingDone: jest.fn(),
  };
  let relay: RelayTarget | undefined;
  const transfer = {
    open: jest.fn(async (_request: unknown, r?: RelayTarget) => {
      relay = r;

      return ENDPOINT;
    }),
    close: jest.fn(),
  };
  const volumes = {
    setDualPrimary: jest.fn(async () => undefined),
    promoteForMigration: jest.fn(async () => '/dev/drbd5'),
    demoteBlock: jest.fn(async () => undefined),
    holdDualPrimary: jest.fn(),
    inDualPrimary: jest.fn(() => true),
    holdForMigration: jest.fn(),
    endMigrationHold: jest.fn(),
  };
  const jobs = {
    exec: jest.fn(async (_id: string, command: string[]) => {
      execs.push(command.slice(1));
      order.push(`exec ${command[1]}`);

      return options.exec ? await options.exec(command.slice(1)) : ok();
    }),
  };
  const vms = { expectIncoming: jest.fn(), incomingDone: jest.fn() };
  const guestVolumes = {
    attach: jest.fn(async (_dir: string, volume: { volume: string }, takeOver?: boolean) => {
      order.push(`attach ${volume.volume}${takeOver ? ' takeover' : ''}`);
    }),
    detach: jest.fn(async (_dir: string, volume: { volume: string }, mode: string) => {
      order.push(`detach ${volume.volume} ${mode}`);
    }),
  };
  const live = { closeReplicaSessions: jest.fn(async () => undefined) };
  const sessions = new MigrationSessions();
  const service = new VmMigrationService(
    docker,
    state,
    commands,
    workloads as unknown as WorkloadManager,
    transfer as unknown as TransferService,
    sessions,
    volumes as unknown as VolumeManager,
    jobs as unknown as BackupJobs,
    vms as unknown as VmSupport,
    guestVolumes as unknown as GuestVolumes,
    live as unknown as LiveSessionsService,
  );
  const batches: string[] = [];
  const syncOps: GuestSyncOps = {
    xattrs: async () => new Map(),
    setXattr: async () => undefined,
    mkfifo: async () => undefined,
  };

  service.pollMs = 5;
  service.freezePollMs = 2;
  service.settleIntervalMs = 5;
  service.syncOps = syncOps;
  service.sendBatch = jest.fn(async (request: { batch: string }) => {
    batches.push(request.batch);
    order.push(`batch ${request.batch}`);

    return 0;
  }) as never;
  service.listenRelay = jest.fn(async () => {
    const r = {
      close: jest.fn(async () => undefined),
      connections: () => 0,
      gate: jest.fn(() => void order.push('gate')),
      release: jest.fn(() => void order.push('release')),
      held: () => 0,
    };

    relays.push(r);

    return r;
  });
  service.attach((envelope: Envelope) => {
    const decoded = decodeAgentMessage(envelope);

    if (!decoded.ok) throw new Error(decoded.error);

    sent.push(decoded.message.payload as MigrationProgress);
  });

  const until = async (check: () => boolean, ms = 3000) => {
    const deadline = Date.now() + ms;

    while (!check()) {
      if (Date.now() > deadline) throw new Error('timed out');

      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const reported = (phase: string, status: string) => sent.find((p) => p.phase === phase && p.status === status);

  return {
    service,
    sent,
    execs,
    updates,
    relays,
    workloads,
    transfer,
    volumes,
    jobs,
    vms,
    sessions,
    commands,
    relay: () => relay,
    until,
    reported,
    guestVolumes,
    live,
    batches,
    order,
    syncOps,
  };
}

const base = { migration: MIGRATION, attempt: 1, replica: REPLICA };
const prepare = (vm = true, mode: 'generic' | 'bundled' = 'generic') => ({
  ...base,
  source: 'n1',
  token: TOKEN,
  addresses: ['10.88.1.10'],
  volumes: vm ? [DISK] : [DATA],
  expiresInSeconds: 60,
  spec: spec(vm, mode),
});
const start = (extra = {}) => ({
  ...base,
  target: 'n2',
  endpoint: ENDPOINT,
  token: TOKEN,
  downtimeLimitMs: 300,
  maxSeconds: 120,
  ...extra,
});

describe('VM live migration on the node (M7.4)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lw-vm-migration-'));
    process.env['LOADWEAVER_STATE_DIR'] = join(root, 'state');
    process.env['LOADWEAVER_RUNTIME_DIR'] = join(root, 'run');
    process.env['LOADWEAVER_VMROOT_DIR'] = join(root, 'vmroot');
  });

  afterEach(async () => {
    delete process.env['LOADWEAVER_STATE_DIR'];
    delete process.env['LOADWEAVER_RUNTIME_DIR'];
    delete process.env['LOADWEAVER_VMROOT_DIR'];
    await rm(root, { recursive: true, force: true });
  });

  it('parses virsh domjobinfo', () => {
    expect(parseDomJobInfo(JOBINFO)).toEqual({
      type: 'Unbounded',
      elapsedMs: 2042,
      processedBytes: Math.round(1.5 * 1024 ** 3),
      remainingBytes: 12 * 1024 ** 2,
      totalBytes: Math.round(4.008 * 1024 ** 3),
      dirtyBytesPerSecond: 2000 * 4096,
      iteration: 3,
      expectedDowntimeMs: 211,
    });
    expect(parseDomJobInfo(COMPLETED)).toMatchObject({ type: 'Completed', downtimeMs: 187 });
    expect(parseDomJobInfo('error: no domain')).toEqual({});
    expect(launcherLibvirtSocket(42)).toBe('/proc/42/root/dev/shm/agenstra-microvm/vmm/run/libvirt/libvirt-sock');
  });

  it('prepares the target: dual-primary, incoming launcher on the kept addresses, relay to its libvirt', async () => {
    const t = setup({ exec: (args) => ok(args[0] === 'state' ? 'running\n' : '') });

    await t.service.handle('vmMigrationPrepare', prepare());
    await t.until(() => !!t.reported('prepare', 'done'));

    expect(t.volumes.setDualPrimary).toHaveBeenCalledWith(DISK, true);
    expect(t.vms.expectIncoming).toHaveBeenCalledWith(REPLICA);
    expect(t.workloads.createReplica).toHaveBeenCalledWith(expect.objectContaining({ addresses: ['10.88.1.10'] }));
    expect(
      await readFile(join(microvmRunDir(join(root, 'run'), REPLICA), 'migration', INCOMING_MARKER), 'utf8'),
    ).toContain(MIGRATION);
    expect(t.reported('prepare', 'done')?.endpoint).toEqual(ENDPOINT);
    expect(t.sessions.protectedReplicas().has(REPLICA)).toBe(true);
    // Only the source's WireGuard addresses reach the endpoint.
    expect(JSON.stringify((t.commands.run as jest.Mock).mock.calls)).toContain('10.93.0.1');

    // The first relay connection promotes the disks (the source allowed two primaries) and goes to libvirt.
    expect(t.volumes.promoteForMigration).not.toHaveBeenCalled();
    await t.relay()?.onConnect?.();
    await t.relay()?.onConnect?.();
    expect(t.volumes.promoteForMigration).toHaveBeenCalledTimes(1);
    expect(await t.relay()?.socketPath()).toBe(launcherLibvirtSocket(4242));

    // The domain runs here: restore done.
    await t.until(() => !!t.reported('restore', 'done'));

    // A repeated prepare re-reports.
    t.sent.length = 0;
    await t.service.handle('vmMigrationPrepare', prepare());
    expect(t.sent.map((p) => `${p.phase}:${p.status}`)).toEqual(['prepare:done', 'restore:done']);

    // Commit: the marker goes (later restarts cold-boot), the window closes, the replica stays protected until its
    // desired state arrives.
    await t.service.handle('migrationCommit', { ...base, role: 'target' });
    expect(t.reported('commit', 'done')).toBeDefined();
    expect(t.transfer.close).toHaveBeenCalledWith(MIGRATION, 1, 'committed');
    expect(t.vms.incomingDone).toHaveBeenCalledWith(REPLICA);
    await expect(
      access(join(microvmRunDir(join(root, 'run'), REPLICA), 'migration', INCOMING_MARKER)),
    ).rejects.toThrow();
    await t.until(() => t.volumes.setDualPrimary.mock.calls.some((c: unknown[]) => c[1] === false));
    expect(t.service.owns('target', MIGRATION, 1)).toBe(false);
    expect(t.sessions.protectedReplicas().has(REPLICA)).toBe(true);
    expect(t.sessions.activeReplicas().has(REPLICA)).toBe(false);
  });

  it('fails the prepare when the incoming bundled launcher cannot be created (older image)', async () => {
    const t = setup();

    t.workloads.createReplica.mockRejectedValueOnce(
      new Error(`${REPLICA}: the bundled image's launcher has no live migration (no incoming mode)`),
    );
    await t.service.handle('vmMigrationPrepare', prepare(false, 'bundled'));
    await t.until(() => !!t.reported('prepare', 'failed'));
    expect(t.reported('prepare', 'failed')?.error).toMatch(/no incoming mode/);
    expect(t.transfer.open).not.toHaveBeenCalled();
  });

  it('aborts on the target: launcher destroyed, disks demoted, window closed', async () => {
    const t = setup({ exec: (args) => ok(args[0] === 'state' ? 'paused\n' : '') });

    await t.service.handle('vmMigrationPrepare', prepare());
    await t.until(() => !!t.reported('prepare', 'done'));
    await t.service.handle('migrationAbort', { ...base, role: 'target', reason: 'x', volumes: [DISK] });

    expect(t.reported('abort', 'done')).toBeDefined();
    expect(t.transfer.close).toHaveBeenCalledWith(MIGRATION, 1, 'aborted');
    expect(t.workloads.removeContainer).toHaveBeenCalledWith('c1', REPLICA);
    expect(t.volumes.demoteBlock).toHaveBeenCalledWith(DISK);
    expect(t.vms.incomingDone).toHaveBeenCalledWith(REPLICA);
    await t.until(() => t.volumes.setDualPrimary.mock.calls.some((c: unknown[]) => c[1] === false));
    expect(t.sessions.protectedReplicas().has(REPLICA)).toBe(false);
  });

  it('migrates from the source: relay socket, restart policy off, progress, switch-over, freeze = downtime', async () => {
    let finish: (out: JobOutput) => void = () => undefined;
    const migrate = new Promise<JobOutput>((resolve) => (finish = resolve));
    const t = setup({
      exec: (args) => {
        if (args[0] === 'migrate') return migrate;

        if (args[0] === 'jobinfo') return ok(JOBINFO);

        if (args[0] === 'jobinfo-completed') return ok(COMPLETED);

        return ok();
      },
    });

    await t.service.handle('vmMigrationStart', start({ maxBandwidthBps: 100 * 1024 ** 2 }));
    await t.until(() => t.sent.some((p) => p.phase === 'precopy' && p.round === 3));

    expect(t.volumes.setDualPrimary).toHaveBeenCalledWith(DISK, true);
    expect(t.updates).toContainEqual({ RestartPolicy: { Name: 'no' } });
    expect(t.service.listenRelay).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: ENDPOINT, peer: 'n2', token: TOKEN, owner: { uid: 10930, gid: 10930 } }),
    );
    expect(t.execs).toContainEqual(['migrate', PEER_SOCKET_IN_LAUNCHER, '300', '100']);
    expect(t.sent.find((p) => p.round === 3)).toMatchObject({
      status: 'running',
      totalBytes: Math.round(1.5 * 1024 ** 3),
      dirtyBytesPerSecond: 2000 * 4096,
    });

    await t.service.handle('vmMigrationSwitchover', base);
    expect(t.execs).toContainEqual(['suspend']);

    finish(ok());
    await t.until(() => !!t.reported('freeze', 'done'));
    expect(t.reported('precopy', 'done')).toBeDefined();
    expect(t.reported('freeze', 'done')?.freezeMs).toBe(187);

    // Commit: the launcher whose domain left goes, the disks are demoted, the window closes.
    await t.service.handle('migrationCommit', { ...base, role: 'source' });
    expect(t.workloads.removeContainer).toHaveBeenCalledWith('c1', REPLICA);
    expect(t.volumes.demoteBlock).toHaveBeenCalledWith(DISK);
    expect(t.relays[0].close).toHaveBeenCalled();
    expect(t.reported('commit', 'done')).toBeDefined();
    expect(t.sessions.protectedReplicas().has(REPLICA)).toBe(false);
    expect(VM_CTL).toBe('/usr/lib/agenstra-microvm/vm-ctl');
  });

  it('gives up a pre-copy that does not converge in time (job aborted, the guest stays)', async () => {
    let finish: (out: JobOutput) => void = () => undefined;
    const migrate = new Promise<JobOutput>((resolve) => (finish = resolve));
    const t = setup({
      exec: (args) => {
        if (args[0] === 'migrate') return migrate;

        if (args[0] === 'migrate-abort')
          finish({ exitCode: 1, stdout: '', stderr: 'cancelled', combined: 'cancelled' });

        return ok(args[0] === 'state' ? 'running\n' : '');
      },
    });

    await t.service.handle('vmMigrationStart', start({ maxSeconds: 0.05 as unknown as number }));
    await t.until(() => !!t.reported('precopy', 'failed'));
    expect(t.reported('precopy', 'failed')?.error).toMatch(/did not converge/);
    expect(t.execs).toContainEqual(['migrate-abort']);

    // Abort: the guest still runs here, the restart policy comes back.
    await t.service.handle('migrationAbort', { ...base, role: 'source', reason: 'x', volumes: [DISK] });
    expect(t.reported('abort', 'done')?.resumed).toBe(true);
    expect(t.updates).toContainEqual({ RestartPolicy: { Name: 'always' } });
    await t.until(() => t.volumes.setDualPrimary.mock.calls.some((c: unknown[]) => c[1] === false));
  });

  it('aborts on the source: cancels the job and resumes a paused guest', async () => {
    let finish: (out: JobOutput) => void = () => undefined;
    const migrate = new Promise<JobOutput>((resolve) => (finish = resolve));
    let paused = false;
    const t = setup({
      exec: (args) => {
        if (args[0] === 'migrate') return migrate;

        if (args[0] === 'migrate-abort') finish({ exitCode: 1, stdout: '', stderr: '', combined: 'cancelled' });

        if (args[0] === 'suspend') paused = true;

        if (args[0] === 'resume') paused = false;

        return ok(args[0] === 'state' ? (paused ? 'paused\n' : 'running\n') : '');
      },
    });

    await t.service.handle('vmMigrationStart', start());
    await t.until(() => t.execs.some((a) => a[0] === 'migrate'));
    await t.service.handle('vmMigrationSwitchover', base);
    await t.service.handle('migrationAbort', { ...base, role: 'source', reason: 'x', volumes: [DISK] });

    expect(t.execs).toContainEqual(['migrate-abort']);
    expect(t.execs).toContainEqual(['resume']);
    expect(t.reported('abort', 'done')?.resumed).toBe(true);
    expect(t.service.owns('source', MIGRATION, 1)).toBe(false);
  });

  it('reports abort / commit of unknown sessions as done and the guest state as it is', async () => {
    const t = setup({ container: { State: 'exited' } });

    await t.service.handle('migrationAbort', { ...base, role: 'source', reason: 'x', volumes: [] });
    await t.service.handle('migrationCommit', { ...base, role: 'target' });
    expect(t.sent.map((p) => `${p.phase}:${p.status}:${p.resumed ?? ''}`)).toEqual([
      'abort:done:false',
      'commit:done:',
    ]);
  });

  it('fails the start when the VM does not run here', async () => {
    const t = setup({ container: null });

    await t.service.handle('vmMigrationStart', start());
    await t.until(() => !!t.reported('precopy', 'failed'));
    expect(t.reported('precopy', 'failed')?.error).toMatch(/doesn't run on this node/);
  });

  it('recovers sessions after an agent restart and keeps their disks out of the reconcile', async () => {
    const t = setup({ exec: () => ok('paused\n') });

    await t.service.handle('vmMigrationPrepare', prepare());
    await t.until(() => !!t.reported('prepare', 'done'));

    const again = setup();

    await again.service.recover();
    expect(again.service.owns('target', MIGRATION, 1)).toBe(true);
    expect(again.volumes.holdDualPrimary).toHaveBeenCalledWith(DISK);
    expect(again.vms.expectIncoming).toHaveBeenCalledWith(REPLICA);
    expect(again.sessions.activeReplicas().has(REPLICA)).toBe(true);
    t.service.onModuleDestroy();
  });

  describe('generic microVMs (M7 W10b)', () => {
    const sessionDir = (role: string) => join(root, 'state', 'vm-migrations', `${MIGRATION}-1-${role}`);
    const RAM = { transferred: 1000, remaining: 10, total: 2000, 'dirty-pages-rate': 10, 'page-size': 4096 };

    it('parses QMP query-migrate', () => {
      expect(parseQueryMigrate(qmp('active', { ...RAM, 'dirty-sync-count': 2 }).stdout)).toEqual({
        status: 'active',
        processedBytes: 1000,
        remainingBytes: 10,
        totalBytes: 2000,
        dirtyBytesPerSecond: 40960,
        iteration: 2,
      });
      expect(parseQueryMigrate(qmp('failed', {}, { 'error-desc': 'boom' }).stdout)).toEqual({
        status: 'failed',
        error: 'boom',
      });
      expect(parseQueryMigrate('error: no domain')).toEqual({});
      expect(launcherIncomingSocket(42)).toBe('/proc/42/root/dev/shm/agenstra-microvm/vmm/incoming.sock');
    });

    it('prepares the target: incoming launcher, guest passes through the merged directory, hand-over, resume', async () => {
      let completed = false;
      let running = false;
      const t = setup({
        generic: true,
        exec: (args) => {
          if (args[0] === 'migrate-status') return qmp(completed ? 'completed' : 'active');

          if (args[0] === 'resume') running = true;

          return ok(args[0] === 'state' ? (running ? 'running\n' : 'paused\n') : '');
        },
      });

      await t.service.handle('vmMigrationPrepare', prepare(false));
      await t.until(() => !!t.reported('prepare', 'done'));

      expect(t.volumes.holdForMigration).toHaveBeenCalledWith(DATA);
      expect(t.volumes.setDualPrimary).not.toHaveBeenCalled();
      expect(t.workloads.expectIncoming).toHaveBeenCalledWith(REPLICA);
      expect(t.vms.expectIncoming).not.toHaveBeenCalled();
      expect(t.relay()?.onConnect).toBeUndefined();
      expect(await t.relay()?.socketPath()).toBe(launcherIncomingSocket(4242));

      // A guest pass from the source, applied to the merged directory before the source gets its answer.
      const source = join(root, 'source-upper');
      const merged = replicaPaths(vmrootConfig(), REPLICA).merged;

      await mkdir(join(source, 'etc'), { recursive: true });
      await writeFile(join(source, 'etc/written-by-guest'), 'hi');
      await mkdir(merged, { recursive: true });
      await mkdir(join(sessionDir('target'), 'guest-1'), { recursive: true });

      const handle = await openTree(source);
      const pass = await scanPass({
        root: handle,
        mode: 'overlay',
        previous: new Map(),
        out: passTarFile(join(sessionDir('target'), 'guest-1', '0.tar')),
        ops: t.syncOps,
      });

      await handle.close();
      await writeFile(
        join(sessionDir('target'), 'guest-1', 'pass.json'),
        JSON.stringify({ roots: [{ root: 0, meta: pass.meta }] }),
      );
      await t.relay()?.onBatch?.('guest-1');
      expect(await readFile(join(merged, 'etc/written-by-guest'), 'utf8')).toBe('hi');
      await expect(access(join(sessionDir('target'), 'guest-1'))).rejects.toThrow();
      await expect(t.relay()?.onBatch?.('../escape')).rejects.toThrow(/unexpected batch/);

      // The hand-over: the volumes are promoted and mounted here (taken over), then QEMU loads its state.
      await t.relay()?.onBatch?.(HANDOVER_BATCH);
      expect(t.guestVolumes.attach).toHaveBeenCalledWith(
        expect.stringContaining('vmvol'),
        expect.objectContaining({ volume: DATA, target: '/data', index: 0 }),
        true,
      );

      completed = true;
      await t.until(() => !!t.reported('restore', 'done'));
      expect(t.execs).toContainEqual(['resume']);

      await t.service.handle('migrationCommit', { ...base, role: 'target' });
      expect(t.workloads.incomingDone).toHaveBeenCalledWith(REPLICA);
      expect(t.volumes.endMigrationHold).toHaveBeenCalledWith(DATA);
      expect(t.volumes.setDualPrimary).not.toHaveBeenCalled();
    });

    it('migrates from the source: guest passes, QMP pre-copy, final pass and volume hand-over in the freeze', async () => {
      let status = 'active';
      const t = setup({
        generic: true,
        exec: (args) => {
          if (args[0] === 'migrate-status')
            return qmp(status, { ...RAM, 'dirty-sync-count': 2 }, status === 'completed' ? { downtime: 120 } : {});

          if (args[0] === 'migrate-continue') status = 'completed';

          return ok(args[0] === 'state' ? 'paused\n' : '');
        },
      });
      const upper = replicaPaths(vmrootConfig(), REPLICA).upper;

      await mkdir(upper, { recursive: true });
      await writeFile(join(upper, 'file'), 'x');

      await t.service.handle('vmMigrationStart', start());
      await t.until(() => t.execs.some((a) => a[0] === 'qmp-migrate'));
      expect(t.execs).toContainEqual(['qmp-migrate', PEER_SOCKET_IN_LAUNCHER, '300']);
      expect(t.volumes.holdForMigration).toHaveBeenCalledWith(DATA);
      expect(t.updates).toContainEqual({ RestartPolicy: { Name: 'no' } });
      await t.until(() => t.sent.some((p) => p.phase === 'precopy' && p.round === 3));

      status = 'pre-switchover';
      await t.until(() => !!t.reported('freeze', 'done'));
      expect(t.reported('freeze', 'done')?.freezeMs).toBeGreaterThanOrEqual(120);
      expect(t.batches).toEqual(['guest-1', 'guest-final', HANDOVER_BATCH]);

      const step = (name: string) => t.order.indexOf(name);

      // The final pass while QEMU waits; QEMU's last data held until the volumes moved; never mounted twice.
      expect(step('batch guest-final')).toBeLessThan(step('exec migrate-continue'));
      expect(step('gate')).toBeLessThan(step('exec migrate-continue'));
      expect(step('exec migrate-continue')).toBeLessThan(step('exec fs-release'));
      expect(step('exec fs-release')).toBeLessThan(step(`detach ${DATA} migration`));
      expect(step(`detach ${DATA} migration`)).toBeLessThan(step(`batch ${HANDOVER_BATCH}`));
      expect(step(`batch ${HANDOVER_BATCH}`)).toBeLessThan(step('release'));

      await t.service.handle('migrationCommit', { ...base, role: 'source' });
      expect(t.live.closeReplicaSessions).toHaveBeenCalledWith(REPLICA, 'replica migrated to n2');
      expect(t.execs).toContainEqual(['destroy']);
      expect(t.workloads.removeContainer).toHaveBeenCalledWith('c1', REPLICA);
      expect(t.volumes.demoteBlock).not.toHaveBeenCalled();
      expect(t.volumes.endMigrationHold).toHaveBeenCalledWith(DATA);
      expect(t.reported('commit', 'done')).toBeDefined();
    });

    it('aborts before the hand-over: the migration is cancelled and the guest runs on here', async () => {
      const t = setup({
        generic: true,
        exec: (args) =>
          args[0] === 'migrate-status' ? qmp('active', RAM) : ok(args[0] === 'state' ? 'running\n' : ''),
      });
      const upper = replicaPaths(vmrootConfig(), REPLICA).upper;

      await mkdir(upper, { recursive: true });
      await t.service.handle('vmMigrationStart', start());
      await t.until(() => t.execs.some((a) => a[0] === 'qmp-migrate'));
      await t.service.handle('migrationAbort', { ...base, role: 'source', reason: 'x', volumes: [DATA] });

      expect(t.execs).toContainEqual(['migrate-cancel']);
      expect(t.reported('abort', 'done')?.resumed).toBe(true);
      expect(t.guestVolumes.detach).not.toHaveBeenCalled();
      expect(t.updates).toContainEqual({ RestartPolicy: { Name: 'always' } });
    });

    it('aborts during the hand-over: the volumes are mounted here again, the guest is not resumed', async () => {
      let status = 'pre-switchover';
      const t = setup({
        generic: true,
        exec: (args) => {
          if (args[0] === 'migrate-status') return qmp(status, RAM);

          if (args[0] === 'migrate-continue') status = 'completed';

          return ok(args[0] === 'state' ? 'paused\n' : '');
        },
      });

      await mkdir(replicaPaths(vmrootConfig(), REPLICA).upper, { recursive: true });
      (t.service.sendBatch as jest.Mock).mockImplementation(async (request: { batch: string }) => {
        if (request.batch === HANDOVER_BATCH) throw new Error('target refused the checkpoint: mount failed');

        return 0;
      });
      await t.service.handle('vmMigrationStart', start());
      await t.until(() => !!t.reported('precopy', 'failed'));
      expect(t.reported('precopy', 'failed')?.error).toMatch(/mount failed/);

      await t.service.handle('migrationAbort', { ...base, role: 'source', reason: 'x', volumes: [DATA] });
      expect(t.reported('abort', 'done')?.resumed).toBe(false);
      expect(t.guestVolumes.attach).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ volume: DATA }),
        true,
      );
      expect(t.execs).not.toContainEqual(['resume']);
    });
  });

  describe('bundled microVMs (M7 F5)', () => {
    const sessionDir = (role: string) => join(root, 'state', 'vm-migrations', `${MIGRATION}-1-${role}`);
    const RAM = { transferred: 1000, remaining: 10, total: 2000, 'dirty-pages-rate': 10, 'page-size': 4096 };
    const WORKSPACE = 'p1/agenstra-env/workspace';
    const bundledVolumes = [
      { type: 'volume', volume: WORKSPACE, target: '/app', readOnly: false },
      { type: 'volume', volume: DATA, target: '/data', readOnly: true },
    ] as WorkloadSpec['volumes'];
    const bundledSpec = { ...spec(false, 'bundled'), volumes: bundledVolumes } as WorkloadSpec;
    const entryNames = async (tar: string): Promise<string[]> => {
      const names: string[] = [];

      for await (const { entry } of readTar(readPassTar(tar))) names.push(entry.name.replace(/\/$/, ''));

      return names;
    };

    it("lists a launcher container's mount points below /guest, relative", () => {
      expect(
        guestMountPoints([
          { Destination: '/guest/app' },
          { Destination: '/guest/run/secrets/token' },
          { Destination: '/guest/app' },
          { Destination: '/etc/hosts' },
          { Destination: '/guest' },
          { Destination: '/run/loadweaver/vm/migration' },
        ]),
      ).toEqual(['app', 'run/secrets/token']);
    });

    it('prepares the target: incoming launcher, passes through its /guest without its mount points, hand-over', async () => {
      let completed = false;
      let running = false;
      const t = setup({
        bundled: { mounts: ['/guest/app', '/guest/data', '/guest/run/secrets/token'] },
        exec: (args) => {
          if (args[0] === 'migrate-status') return qmp(completed ? 'completed' : 'active');

          if (args[0] === 'resume') running = true;

          return ok(args[0] === 'state' ? (running ? 'running\n' : 'paused\n') : '');
        },
      });
      const proc = join(root, 'proc');
      const guest = join(proc, 'root', 'guest');

      t.service.procDir = () => proc;
      await t.service.handle('vmMigrationPrepare', { ...prepare(false, 'bundled'), spec: bundledSpec });
      await t.until(() => !!t.reported('prepare', 'done'));

      expect(t.workloads.expectIncoming).toHaveBeenCalledWith(REPLICA);
      expect(t.workloads.createReplica).toHaveBeenCalled();
      expect(t.volumes.holdForMigration).toHaveBeenCalledWith(WORKSPACE);
      expect(t.volumes.holdForMigration).toHaveBeenCalledWith(DATA);
      expect(t.volumes.setDualPrimary).not.toHaveBeenCalled();
      expect(await t.relay()?.socketPath()).toBe(launcherIncomingSocket(4242));
      expect(
        await readFile(join(microvmRunDir(join(root, 'run'), REPLICA), 'migration', INCOMING_MARKER), 'utf8'),
      ).toBe(`${MIGRATION}\n`);

      // The target launcher's /guest: image content, the (empty) volume mount point, a secret file.
      await mkdir(join(guest, 'app'), { recursive: true });
      await mkdir(join(guest, 'run/secrets'), { recursive: true });
      await writeFile(join(guest, 'run/secrets/token'), 'secret');
      await writeFile(join(guest, 'gone'), 'old');

      // The source's writable layer below guest/: the guest's change plus Docker's mount point placeholders.
      const upper = join(root, 'source-upper', 'guest');

      await mkdir(join(upper, 'etc'), { recursive: true });
      await mkdir(join(upper, 'app'), { recursive: true });
      await mkdir(join(upper, 'run/secrets'), { recursive: true });
      await writeFile(join(upper, 'etc/written-by-guest'), 'hi');
      await writeFile(join(upper, 'app/below-mount-point'), 'never');
      await writeFile(join(upper, 'run/secrets/token'), '');
      await mkdir(join(sessionDir('target'), 'guest-1'), { recursive: true });

      const handle = await openTree(upper);
      const pass = await scanPass({
        root: handle,
        mode: 'overlay',
        previous: new Map(),
        out: passTarFile(join(sessionDir('target'), 'guest-1', '0.tar')),
        ops: t.syncOps,
      });

      await handle.close();
      await writeFile(
        join(sessionDir('target'), 'guest-1', 'pass.json'),
        JSON.stringify({ roots: [{ root: 0, meta: { ...pass.meta, remove: ['gone', 'app', 'run'] } }] }),
      );
      await t.relay()?.onBatch?.('guest-1');
      expect(await readFile(join(guest, 'etc/written-by-guest'), 'utf8')).toBe('hi');
      // Mount points (and what holds them) stay the target launcher's own.
      expect(await readFile(join(guest, 'run/secrets/token'), 'utf8')).toBe('secret');
      await expect(access(join(guest, 'app/below-mount-point'))).rejects.toThrow();
      await expect(access(join(guest, 'gone'))).rejects.toThrow();
      await access(join(guest, 'app'));

      // The hand-over: taken over into the volume directory; the read-only one remounted in the launcher.
      await t.relay()?.onBatch?.(HANDOVER_BATCH);
      expect(t.guestVolumes.attach).toHaveBeenCalledWith(
        expect.stringContaining('vmvol'),
        expect.objectContaining({ volume: WORKSPACE, target: '/app', readOnly: false }),
        true,
      );
      expect(t.commands.run).toHaveBeenCalledWith('nsenter', [
        '-t',
        '4242',
        '-m',
        '--',
        'mount',
        '-o',
        'remount,bind,ro',
        '/guest/data',
      ]);
      // Only the read-only volume (the read-write one keeps the flags it was mounted with).
      expect((t.commands.run as jest.Mock).mock.calls.filter(([command]) => command === 'nsenter')).toHaveLength(1);

      completed = true;
      await t.until(() => !!t.reported('restore', 'done'));
      expect(t.execs).toContainEqual(['resume']);

      await t.service.handle('migrationCommit', { ...base, role: 'target' });
      expect(t.workloads.incomingDone).toHaveBeenCalledWith(REPLICA);
      expect(t.volumes.endMigrationHold).toHaveBeenCalledWith(WORKSPACE);
    });

    it('migrates from the source: writable layer passes, launcher killed for the volume hand-over', async () => {
      let status = 'active';
      const upper = join(root, 'source-upper');
      const t = setup({
        bundled: {
          env: ['AGENSTRA_MICROVM_MIGRATION=1'],
          mounts: ['/guest/app', '/guest/run/cache'],
          upper,
          volumes: [
            { type: 'volume', volume: WORKSPACE, target: '/app', readOnly: false },
            { type: 'tmpfs', target: '/run/cache', sizeBytes: 1024 * 1024 },
          ] as WorkloadSpec['volumes'],
        },
        exec: (args) => {
          if (args[0] === 'migrate-status')
            return qmp(status, { ...RAM, 'dirty-sync-count': 2 }, status === 'completed' ? { downtime: 90 } : {});

          if (args[0] === 'migrate-continue') status = 'completed';

          return ok(args[0] === 'state' ? 'paused\n' : '');
        },
      });
      const proc = join(root, 'proc');
      const passes = new Map<string, string[][]>();

      t.service.procDir = () => proc;
      await mkdir(join(proc, 'root', 'guest', 'run', 'cache'), { recursive: true });
      await writeFile(join(proc, 'root', 'guest', 'run', 'cache', 'warm'), 'w');
      await mkdir(join(upper, 'guest', 'home'), { recursive: true });
      await mkdir(join(upper, 'guest', 'app'), { recursive: true });
      await mkdir(join(upper, 'usr', 'lib', 'launcher-state'), { recursive: true });
      await writeFile(join(upper, 'guest', 'home', 'notes'), 'n');
      await writeFile(join(upper, 'guest', 'app', 'shadowed'), 's');
      (t.service.sendBatch as jest.Mock).mockImplementation(
        async (request: { batch: string; root: string; paths: string[] }) => {
          t.batches.push(request.batch);
          t.order.push(`batch ${request.batch}`);

          if (request.batch !== HANDOVER_BATCH)
            passes.set(request.batch, [
              await entryNames(join(request.root, request.batch, '0.tar')),
              await entryNames(join(request.root, request.batch, '1.tar')),
            ]);

          return 0;
        },
      );

      await t.service.handle('vmMigrationStart', start());
      await t.until(() => t.execs.some((a) => a[0] === 'qmp-migrate'));
      expect(t.volumes.holdForMigration).toHaveBeenCalledWith(WORKSPACE);
      expect(t.updates).toContainEqual({ RestartPolicy: { Name: 'no' } });
      // guest/ of the writable layer without the volume's mount point; the tmpfs volume through the launcher's root.
      expect(passes.get('guest-1')?.[0].sort()).toEqual(['home', 'home/notes']);
      expect(passes.get('guest-1')?.[1]).toEqual(['warm']);

      status = 'pre-switchover';
      await t.until(() => !!t.reported('freeze', 'done'));
      expect(t.batches).toEqual(['guest-1', 'guest-final', HANDOVER_BATCH]);

      const step = (name: string) => t.order.indexOf(name);

      // No fs-release: the image root's virtiofsd holds the volumes, so the launcher goes once QEMU's state left.
      expect(t.execs).not.toContainEqual(['fs-release']);
      expect(step('gate')).toBeLessThan(step('exec migrate-continue'));
      expect(step('exec migrate-continue')).toBeLessThan(step('kill'));
      expect(step('kill')).toBeLessThan(step(`detach ${WORKSPACE} migration`));
      expect(step(`detach ${WORKSPACE} migration`)).toBeLessThan(step(`batch ${HANDOVER_BATCH}`));
      expect(step(`batch ${HANDOVER_BATCH}`)).toBeLessThan(step('release'));
      expect(t.reported('freeze', 'done')?.freezeMs).toBeGreaterThanOrEqual(90);

      await t.service.handle('migrationCommit', { ...base, role: 'source' });
      expect(t.live.closeReplicaSessions).toHaveBeenCalledWith(REPLICA, 'replica migrated to n2');
      expect(t.workloads.removeContainer).toHaveBeenCalledWith('c1', REPLICA);
      expect(t.reported('commit', 'done')).toBeDefined();
    });

    it('refuses a source launcher that does not run in migration mode', async () => {
      const t = setup({ bundled: { env: [], upper: join(root, 'upper') } });

      await t.service.handle('vmMigrationStart', start());
      await t.until(() => !!t.reported('precopy', 'failed'));
      expect(t.reported('precopy', 'failed')?.error).toMatch(/does not run in migration mode/);
      expect(t.execs).not.toContainEqual(expect.arrayContaining(['qmp-migrate']));
    });

    it('aborts before the hand-over: cancelled, the guest runs on in its launcher', async () => {
      const upper = join(root, 'source-upper');
      const t = setup({
        bundled: { env: ['AGENSTRA_MICROVM_MIGRATION=1'], upper },
        exec: (args) =>
          args[0] === 'migrate-status' ? qmp('active', RAM) : ok(args[0] === 'state' ? 'running\n' : ''),
      });

      // A layer without guest/ yet: nothing to pre-copy of the root.
      await mkdir(upper, { recursive: true });
      await t.service.handle('vmMigrationStart', start());
      await t.until(() => t.execs.some((a) => a[0] === 'qmp-migrate'));
      await t.service.handle('migrationAbort', { ...base, role: 'source', reason: 'x', volumes: [DATA] });

      expect(t.execs).toContainEqual(['migrate-cancel']);
      expect(t.reported('abort', 'done')?.resumed).toBe(true);
      expect(t.order).not.toContain('kill');
      expect(t.updates).toContainEqual({ RestartPolicy: { Name: 'always' } });
    });
  });
});
