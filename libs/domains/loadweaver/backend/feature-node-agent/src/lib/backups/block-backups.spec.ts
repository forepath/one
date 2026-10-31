import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decodeAgentMessage,
  type BackupProgress,
  type Envelope,
  type VolumeAssignment,
} from '@forepath/loadweaver/shared/util-agent-protocol';

import { BackupService } from './backup.manager';
import { jobName, type JobContainerSpec, type JobOutput } from './backup-jobs';

const BACKUP = '0b0e2a64-7c1d-4f5e-9a8b-1c2d3e4f5a6b';
const RESTORE = '1c1f3b75-8d2e-4a6f-8b9c-2d3e4f5a6b7c';
const NAME = jobName(BACKUP);
const RNAME = jobName(RESTORE);
const ROOT = `k${'a'.repeat(32)}`;
const DISK_BYTES = 20 * 1024 ** 3;
const MANIFEST = JSON.stringify({
  id: 'b'.repeat(32),
  startTime: '2026-10-19T12:00:00Z',
  endTime: '2026-10-19T12:05:00Z',
  rootEntry: { obj: ROOT, summ: { size: DISK_BYTES, files: 1 } },
  stats: { uploadedBytes: 1024 },
});

/** The boot disk of VM `db1` (block mode, 3.35). */
const disk: VolumeAssignment = {
  id: 'shop/lw-vm/db1.root',
  dockerName: 'lw-vol-shop.lw-vm.db1.root',
  minor: 1003,
  port: 7803,
  sizeBytes: DISK_BYTES + 8 * 1024 ** 2,
  replicas: [
    { node: 'n1', nodeId: 0, address: '10.93.0.1' },
    { node: 'n2', nodeId: 1, address: '10.93.0.2' },
  ],
  connections: [{ a: 'n1', b: 'n2', protocol: 'C' }],
  primary: 'n1',
  keyRef: 'secret://shop/lw-volume-lw-vm.db1.root',
  mode: 'block',
};

const repository = {
  scope: 'project-shop',
  servers: [{ address: '10.93.0.10', port: 7700 }],
  fingerprint: 'f'.repeat(64),
  username: 'v-lw-vm.db1.root',
  hostname: 'shop',
  password: 'P'.repeat(43),
};

const ok = (stdout = ''): JobOutput => ({ exitCode: 0, stdout, stderr: '', combined: stdout });

describe('backups of VM disks (block mode, M7.3)', () => {
  let dir: string;
  let calls: string[];
  let specs: JobContainerSpec[];
  let reports: BackupProgress[];

  const setup = (options: { running?: boolean; frozen?: boolean } = {}) => {
    const commands = {
      run: jest.fn(async (command: string, args: readonly string[]) => {
        calls.push(`${command} ${args.join(' ')}`);

        if (command === 'drbdsetup')
          return { stdout: JSON.stringify([{ devices: [{ 'disk-state': 'UpToDate' }] }]), stderr: '' };

        return { stdout: '', stderr: '' };
      }),
      json: jest.fn(async () => ({ report: [{ lv: [] }] })),
    };
    const volumes = {
      assignment: jest.fn((id: string) => (id === disk.id ? disk : undefined)),
      nodeName: () => 'n1',
      mountedPath: jest.fn(async () => null),
      assertMemoryFs: jest.fn(async () => undefined),
      volumeKeyFileOption: jest.fn(async () => '--volume-key-file'),
      blockSizeBytes: jest.fn(async () => DISK_BYTES),
      promoteBlock: jest.fn(async () => (calls.push('promote'), { device: '/dev/drbd1003', fresh: false })),
      demoteBlock: jest.fn(async () => void calls.push('demote')),
      mount: jest.fn(),
    };
    const runner = {
      run: jest.fn(async (spec: JobContainerSpec) => {
        specs.push(spec);
        calls.push(`job ${spec.name.slice(NAME.length + 1)}`);

        return spec.name.endsWith('-snapshot') ? ok(MANIFEST) : ok();
      }),
      stop: jest.fn(async (id: string) => void calls.push(`stop ${id}`)),
      start: jest.fn(async (id: string) => void calls.push(`start ${id}`)),
    };
    const vms = {
      launcherOf: jest.fn(async () => (options.running ? { Id: 'c-db1' } : undefined)),
      freeze: jest.fn(async () => (calls.push('fsfreeze'), !!options.frozen)),
      thaw: jest.fn(async () => void calls.push('fsthaw')),
    };
    const sessions = { begin: jest.fn(), end: jest.fn(() => void calls.push('unprotect')) };
    const workloads = { reapply: jest.fn(async () => (calls.push('reapply'), true)) };
    const service = new BackupService(
      commands as never,
      volumes as never,
      { fetch: jest.fn(async () => Buffer.from('volume-secret')) } as never,
      workloads as never,
      runner as never,
      { dir, appliedState: jest.fn(async () => null) } as never,
      sessions as never,
      vms as never,
    );

    service.attach((envelope: Envelope) => {
      const decoded = decodeAgentMessage(envelope);

      if (!decoded.ok) throw new Error(decoded.error);

      reports.push(decoded.message.payload as BackupProgress);
    });

    return { service, volumes, runner, vms, sessions };
  };

  const final = () => reports.filter((r) => r.status !== 'running').pop();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-bk-block-'));
    process.env['LOADWEAVER_KEY_TMPFS'] = join(dir, 'run');
    calls = [];
    specs = [];
    reports = [];
  });

  afterEach(async () => {
    delete process.env['LOADWEAVER_KEY_TMPFS'];
    await rm(dir, { recursive: true, force: true });
  });

  it('freezes a running guest around the LV snapshot and streams the exact disk into Kopia', async () => {
    const { service } = setup({ running: true, frozen: true });

    await service.handle('backupRun', {
      backup: BACKUP,
      volume: disk.id,
      repository,
      description: 'nightly',
      tags: { policy: 'nightly' },
    });
    await service.idle();

    expect(calls).toEqual([
      'drbdsetup status lw-1003 --json',
      'fsfreeze',
      `lvcreate -q -s -kn -n ${NAME} loadweaver/lw-1003`,
      'fsthaw',
      `lvchange -ay -K loadweaver/${NAME}`,
      expect.stringMatching(
        new RegExp(
          `^cryptsetup open --readonly --type luks2 --volume-key-file .+ /dev/loadweaver/${NAME} ${NAME}-crypt$`,
        ),
      ),
      // The guest's disk only: DRBD's metadata at the end of the LV stays out.
      `dmsetup create ${NAME}-disk --readonly --table 0 ${DISK_BYTES / 512} linear /dev/mapper/${NAME}-crypt 0`,
      'job connect',
      'job snapshot',
      `dmsetup remove ${NAME}-disk`,
      `cryptsetup close ${NAME}-crypt`,
      `lvremove -y loadweaver/${NAME}`,
    ]);

    const snapshot = specs.find((s) => s.name.endsWith('-snapshot')) as JobContainerSpec;

    expect(snapshot.entrypoint).toEqual(['/bin/sh', '-c']);
    expect(snapshot.cmd[0]).toContain('exec kopia snapshot create "$@" <"$device"');
    expect(snapshot.cmd.slice(1)).toEqual([
      'sh',
      `/dev/mapper/${NAME}-disk`,
      '--stdin-file=db1.root.raw',
      '/volume',
      '--json',
      '--parallel=4',
      '--description=nightly',
      '--tags=policy:nightly',
      '--tags=consistency:filesystem-frozen',
    ]);
    // Read-only access to the view only; no capabilities, no other binds than the client state.
    expect(snapshot.devices).toEqual([{ path: `/dev/mapper/${NAME}-disk`, permissions: 'r' }]);
    expect(snapshot.capAdd).toEqual([]);
    expect(snapshot.binds).toHaveLength(1);
    expect(final()).toMatchObject({
      status: 'done',
      bytes: DISK_BYTES,
      files: 1,
      uploadedBytes: 1024,
      hooks: true,
      snapshot: { rootObject: ROOT },
    });
  });

  it('takes a crash-consistent snapshot without a guest agent (or a running VM) and says so', async () => {
    const { service, vms } = setup({ running: true, frozen: false });

    await service.handle('backupRun', { backup: BACKUP, volume: disk.id, repository, description: 'd', tags: {} });
    await service.idle();

    expect(calls).not.toContain('fsthaw');
    expect(specs.find((s) => s.name.endsWith('-snapshot'))?.cmd).toContain('--tags=consistency:crash');
    expect(final()?.hooks).toBeUndefined();

    calls = [];
    specs = [];

    const stopped = setup({ running: false });

    await stopped.service.handle('backupRun', {
      backup: '2d4e6f80-1a2b-4c3d-8e5f-6a7b8c9d0e1f',
      volume: disk.id,
      repository,
      description: 'd',
      tags: {},
    });
    await stopped.service.idle();
    expect(stopped.vms.freeze).not.toHaveBeenCalled();
    expect(vms.freeze).toHaveBeenCalledTimes(1);
  });

  it('restores a whole VM disk onto its device with the VM stopped, then lets the reconcile restart it (G5)', async () => {
    const { service, sessions } = setup({ running: true });

    await service.handle('restoreRun', {
      restore: RESTORE,
      kind: 'volume',
      snapshot: ROOT,
      repository,
      volume: disk.id,
      mode: 'replace',
    });
    await service.idle();

    expect(final()).toMatchObject({ status: 'done' });
    expect(calls.filter((c) => !c.startsWith('job connect'))).toEqual([
      'stop c-db1',
      'promote',
      'job restore',
      // Not `start c-db1`: the launcher may be gone meanwhile, or the VM stopped; the desired state decides.
      'unprotect',
      'reapply',
    ]);
    expect(sessions.begin).toHaveBeenCalledWith('shop/lw-vm/db1/0');
    expect(sessions.end).toHaveBeenCalledWith('shop/lw-vm/db1/0');

    const restore = specs.find((s) => s.name === `${RNAME}-restore`) as JobContainerSpec;

    expect(restore.cmd[0]).toContain('exec kopia show "$1" >"$2"');
    expect(restore.cmd.slice(1)).toEqual(['sh', `${ROOT}/db1.root.raw`, '/dev/drbd1003']);
    expect(restore.devices).toEqual([{ path: '/dev/drbd1003', permissions: 'rw' }]);
  });

  it('demotes a stopped VM disk after a restore and refuses single-path restores', async () => {
    const { service } = setup({ running: false });

    await service.handle('restoreRun', {
      restore: RESTORE,
      kind: 'volume',
      snapshot: ROOT,
      repository,
      volume: disk.id,
    });
    await service.idle();
    expect(calls.filter((c) => !c.startsWith('job connect'))).toEqual(['promote', 'job restore', 'demote']);

    const other = setup();

    reports = [];
    await other.service.handle('restoreRun', {
      restore: '3e5f7091-2b3c-4d5e-9f6a-7b8c9d0e1f2a',
      kind: 'path',
      snapshot: ROOT,
      repository,
      volume: disk.id,
      path: 'etc/hosts',
    });
    await other.service.idle();
    expect(final()).toMatchObject({ status: 'failed', error: expect.stringContaining('VM disks are restored whole') });
  });
});
