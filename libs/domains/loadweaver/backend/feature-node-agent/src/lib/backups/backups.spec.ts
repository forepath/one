import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decodeAgentMessage,
  restoreRunSchema,
  type BackupProgress,
  type BackupRepositoryServer,
  type Envelope,
  type VolumeAssignment,
} from '@forepath/loadweaver/shared/util-agent-protocol';

import { BackupService, parseSnapshotManifest } from './backup.manager';
import { demux, jobName, type JobContainerSpec, type JobOutput } from './backup-jobs';
import { kopiaGoMemoryLimit, KopiaServerManager, kopiaServerSpec } from './kopia-server.manager';

const BACKUP = '0b0e2a64-7c1d-4f5e-9a8b-1c2d3e4f5a6b';
const RESTORE = '1c1f3b75-8d2e-4a6f-8b9c-2d3e4f5a6b7c';
const NAME = jobName(BACKUP);
const PASSWORD = 'P'.repeat(43);
const ROOT = `k${'a'.repeat(32)}`;
const MANIFEST = JSON.stringify({
  id: 'b'.repeat(32),
  startTime: '2026-10-19T12:00:00.123456789Z',
  endTime: '2026-10-19T12:00:05Z',
  rootEntry: { obj: ROOT, summ: { size: 4096, files: 3 } },
});

const volume: VolumeAssignment = {
  id: 'shop/db/data',
  dockerName: 'lw-vol-shop.db.data',
  minor: 1000,
  port: 7800,
  sizeBytes: 512 * 1024 ** 2,
  replicas: [
    { node: 'n1', nodeId: 0, address: '10.93.0.1' },
    { node: 'n2', nodeId: 1, address: '10.93.0.2' },
  ],
  connections: [{ a: 'n1', b: 'n2', protocol: 'C' }],
  primary: 'n1',
  keyRef: 'secret://shop/lw-volume-db.data',
};

const repository = {
  scope: 'project-shop',
  servers: [
    { address: '10.93.0.10', port: 7700 },
    { address: '10.93.0.11', port: 7700 },
  ],
  fingerprint: 'f'.repeat(64),
  username: 'v-db.data',
  hostname: 'shop',
  password: PASSWORD,
};

const backupRun = (overrides: Record<string, unknown> = {}) => ({
  backup: BACKUP,
  volume: volume.id,
  repository,
  description: 'nightly; rm -rf /',
  tags: { policy: 'nightly' },
  hooks: { replica: 'shop/db/store/0', pre: ['sh', '-c', 'sync'], post: ['true'], timeoutSeconds: 30 },
  ...overrides,
});

const restoreRun = (overrides: Record<string, unknown> = {}) => ({
  restore: RESTORE,
  kind: 'volume',
  snapshot: ROOT,
  repository,
  volume: volume.id,
  ...overrides,
});

const ok = (stdout = ''): JobOutput => ({ exitCode: 0, stdout, stderr: '', combined: stdout });

describe('backups (node side of 3.20)', () => {
  let dir: string;
  let calls: string[];
  let reports: BackupProgress[];
  let failAt: string | null;
  let runResults: Record<string, JobOutput>;
  let mounted: string | null;

  const setup = () => {
    const commands = {
      run: jest.fn(async (command: string, args: readonly string[]) => {
        const line = `${command} ${args.join(' ')}`;

        calls.push(line);

        if (failAt && line.startsWith(failAt)) throw new Error(`${command} failed`);

        if (command === 'drbdsetup')
          return { stdout: JSON.stringify([{ devices: [{ 'disk-state': 'UpToDate' }] }]), stderr: '' };

        if (command === 'blkid') return { stdout: 'ext4\n', stderr: '' };

        return { stdout: '', stderr: '' };
      }),
      json: jest.fn(async () => ({
        report: [{ lv: [{ lv_name: 'lw-1000' }, { lv_name: 'lw-bk-0123456789abcdef' }] }],
      })),
    };
    const volumes = {
      assignment: jest.fn((id: string) => (id === volume.id ? volume : undefined)),
      nodeName: () => 'n1',
      mountedPath: jest.fn(async () => mounted),
      mount: jest.fn(async () => (calls.push('volume mount'), '/var/lib/loadweaver/volumes/lw-vol-shop.db.data')),
      unmount: jest.fn(async () => void calls.push('volume unmount')),
      assertMemoryFs: jest.fn(async () => undefined),
      volumeKeyFileOption: jest.fn(async () => '--volume-key-file'),
    };
    const secrets = { fetch: jest.fn(async () => Buffer.from('volume-secret')) };
    const workloads = {
      containerOf: jest.fn(async () => ({ Id: 'c-store', State: 'running', Labels: {} })),
    };
    const runner = {
      run: jest.fn(async (spec: JobContainerSpec) => {
        const step = spec.name.slice(NAME.length + 1);

        calls.push(`job ${step} ${spec.cmd.slice(0, 3).join(' ')}`);

        if (failAt === `job ${step}`) return { exitCode: 1, stdout: '', stderr: 'boom', combined: 'boom' };

        return runResults[step] ?? ok();
      }),
      exec: jest.fn(async (_c: string, command: string[]) => {
        calls.push(`exec ${command.join(' ')}`);

        return failAt === `exec ${command.join(' ')}`
          ? { exitCode: 2, stdout: '', stderr: 'locked', combined: 'locked' }
          : ok();
      }),
      usersOf: jest.fn(async () => [
        { Id: 'c-store', Labels: { 'loadweaver.com/workload': 'shop/db/store/0' } },
        { Id: 'c-other', Labels: {} },
      ]),
      stop: jest.fn(async (id: string) => void calls.push(`stop ${id}`)),
      start: jest.fn(async (id: string) => void calls.push(`start ${id}`)),
      removeLeftovers: jest.fn(async () => (calls.push('remove job containers'), 1)),
    };
    const sessions = { begin: jest.fn(), end: jest.fn() };
    const state = { dir, appliedState: jest.fn(async () => null) };
    const service = new BackupService(
      commands as never,
      volumes as never,
      secrets as never,
      workloads as never,
      runner as never,
      state as never,
      sessions as never,
    );

    service.attach((envelope: Envelope) => {
      const decoded = decodeAgentMessage(envelope);

      if (!decoded.ok) throw new Error(decoded.error);

      expect(envelope.channel).toBe(`backup:${(decoded.message.payload as BackupProgress).id}`);
      reports.push(decoded.message.payload as BackupProgress);
    });

    return { service, commands, volumes, secrets, runner, sessions };
  };

  const final = () => reports.filter((r) => r.status !== 'running').pop();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-bk-'));
    process.env['LOADWEAVER_KEY_TMPFS'] = join(dir, 'run');
    calls = [];
    reports = [];
    failAt = null;
    mounted = '/var/lib/loadweaver/volumes/lw-vol-shop.db.data';
    runResults = { snapshot: ok(MANIFEST) };
  });

  afterEach(async () => {
    delete process.env['LOADWEAVER_KEY_TMPFS'];
    await rm(dir, { recursive: true, force: true });
  });

  describe('backupRun', () => {
    it('runs hooks around a frozen snapshot, uploads read-only and cleans up', async () => {
      const { service, secrets } = setup();

      await service.handle('backupRun', backupRun());
      await service.idle();

      expect(calls).toEqual([
        'drbdsetup status lw-1000 --json',
        'exec sh -c sync',
        'fsfreeze -f /var/lib/loadweaver/volumes/lw-vol-shop.db.data',
        `lvcreate -q -s -kn -n ${NAME} loadweaver/lw-1000`,
        'fsfreeze -u /var/lib/loadweaver/volumes/lw-vol-shop.db.data',
        `lvchange -ay -K loadweaver/${NAME}`,
        'exec true',
        expect.stringMatching(
          new RegExp(
            `^cryptsetup open --readonly --type luks2 --volume-key-file \\S+/volume\\.key /dev/loadweaver/${NAME} ${NAME}-crypt$`,
          ),
        ),
        `blkid -p -u filesystem -o value -s TYPE /dev/mapper/${NAME}-crypt`,
        `mount -t ext4 -o ro,noload,nodev,nosuid,noexec /dev/mapper/${NAME}-crypt ${join(dir, 'run', 'backups', NAME)}`,
        'job connect repository connect server',
        'job snapshot snapshot create /volume',
        `umount ${join(dir, 'run', 'backups', NAME)}`,
        `cryptsetup close ${NAME}-crypt`,
        `lvremove -y loadweaver/${NAME}`,
      ]);
      // The volume key file lived on the key tmpfs and is gone.
      expect(calls[7]).toContain(join(dir, 'run', `${NAME}-`));
      expect((await readdir(join(dir, 'run'))).filter((e) => e.startsWith(NAME))).toEqual([]);
      expect(secrets.fetch).toHaveBeenCalledWith('volume:shop/db/data', volume.keyRef);
      expect(reports.map((r) => `${r.status}:${r.phase ?? ''}`)).toEqual([
        'running:hooks',
        'running:snapshot',
        'running:upload',
        'done:',
      ]);
      expect(final()).toEqual({
        id: BACKUP,
        operation: 'backup',
        status: 'done',
        bytes: 4096,
        files: 3,
        snapshot: {
          manifestId: 'b'.repeat(32),
          rootObject: ROOT,
          startTime: '2026-10-19T12:00:00.123Z',
          endTime: '2026-10-19T12:00:05.000Z',
        },
        hooks: true,
      });
    });

    it('connects with the pinned fingerprint as the volume user; secrets only in the environment', async () => {
      const { service, runner } = setup();

      await service.handle('backupRun', backupRun());
      await service.idle();

      const [connect, snapshot] = runner.run.mock.calls.map((c) => c[0]);

      expect(connect.cmd).toEqual([
        'repository',
        'connect',
        'server',
        '--url=https://10.93.0.10:7700',
        `--server-cert-fingerprint=${'f'.repeat(64)}`,
        '--override-username=v-db.data',
        '--override-hostname=shop',
      ]);
      expect(connect.network).toBe('host');
      expect(connect.env).toEqual({ KOPIA_PASSWORD: PASSWORD, KOPIA_CHECK_FOR_UPDATES: 'false', GOMEMLIMIT: '819MiB' });
      expect(JSON.stringify([connect.cmd, snapshot.cmd])).not.toContain(PASSWORD);
      // Description and tags are single arguments (no shell).
      expect(snapshot.cmd).toEqual([
        'snapshot',
        'create',
        '/volume',
        '--json',
        '--description=nightly; rm -rf /',
        '--tags=policy:nightly',
      ]);
      expect(snapshot.binds).toContain(`${join(dir, 'run', 'backups', NAME)}:/volume:ro`);
      expect(snapshot.capAdd).toEqual(['DAC_READ_SEARCH']);
    });

    it('tries the next repository server when one is unreachable', async () => {
      const { service, runner } = setup();
      let attempts = 0;

      runner.run.mockImplementation(async (spec: JobContainerSpec) => {
        if (spec.name.endsWith('-connect'))
          return ++attempts === 1 ? { exitCode: 1, stdout: '', stderr: 'refused', combined: 'refused' } : ok();

        return ok(MANIFEST);
      });
      await service.handle('backupRun', backupRun({ hooks: undefined }));
      await service.idle();

      expect(runner.run.mock.calls[1][0].cmd[3]).toBe('--url=https://10.93.0.11:7700');
      expect(final()?.status).toBe('done');
      expect(final()?.hooks).toBeUndefined();
    });

    it.each([
      ['lvcreate', ['fsfreeze -u', 'exec true', 'lvremove'], ['cryptsetup open', 'job']],
      ['cryptsetup open', ['lvremove', 'cryptsetup close'], ['mount -t', 'job']],
      ['mount -t', ['umount', 'cryptsetup close', 'lvremove'], ['job']],
      ['job connect', ['umount', 'cryptsetup close', 'lvremove'], ['job snapshot']],
      ['job snapshot', ['umount', 'cryptsetup close', 'lvremove'], []],
    ])('cleans up when %s fails', async (step, expected, never) => {
      const { service } = setup();

      failAt = step;
      await service.handle('backupRun', backupRun());
      await service.idle();

      expect(final()).toMatchObject({ status: 'failed', operation: 'backup' });
      for (const line of expected) expect(calls.some((c) => c.startsWith(line))).toBe(true);
      for (const line of never) expect(calls.some((c) => c.startsWith(line))).toBe(false);
    });

    it('a failing pre hook stops the backup, the post hook still runs, no snapshot is taken', async () => {
      const { service } = setup();

      failAt = 'exec sh -c sync';
      await service.handle('backupRun', backupRun());
      await service.idle();

      expect(calls.some((c) => c.startsWith('lvcreate'))).toBe(false);
      expect(calls).toContain('exec true');
      expect(final()).toMatchObject({ status: 'failed', error: expect.stringContaining('pre hook failed (exit 2)') });
    });

    it('a failing post hook fails the backup after the snapshot, which is removed', async () => {
      const { service } = setup();

      failAt = 'exec true';
      await service.handle('backupRun', backupRun());
      await service.idle();

      expect(calls.some((c) => c.startsWith('job'))).toBe(false);
      expect(calls[calls.length - 1]).toBe(`lvremove -y loadweaver/${NAME}`);
      expect(final()).toMatchObject({ status: 'failed', error: expect.stringContaining('post hook failed') });
    });

    it('refuses volumes whose primary is elsewhere or that are not up to date', async () => {
      const { service, commands } = setup();

      await service.handle('backupRun', backupRun({ volume: 'shop/db/other' }));
      await service.idle();
      expect(final()?.error).toContain('has no replica on this node');

      commands.run.mockImplementationOnce(async () => ({
        stdout: JSON.stringify([{ devices: [{ 'disk-state': 'Inconsistent' }] }]),
        stderr: '',
      }));
      await service.handle('backupRun', backupRun({ backup: '2d2f3b75-8d2e-4a6f-8b9c-2d3e4f5a6b7c' }));
      await service.idle();
      expect(final()?.error).toContain('not up to date here (Inconsistent)');
    });

    it('does not freeze a volume that is not mounted here', async () => {
      const { service } = setup();

      mounted = null;
      await service.handle('backupRun', backupRun({ hooks: undefined }));
      await service.idle();

      expect(calls.some((c) => c.startsWith('fsfreeze'))).toBe(false);
      expect(final()?.status).toBe('done');
    });

    it('is idempotent per id: a re-sent command re-reports, also after an agent restart', async () => {
      const first = setup();

      await first.service.handle('backupRun', backupRun());
      // Re-sent while running: reported as running, not started twice.
      await first.service.handle('backupRun', backupRun());
      await first.service.idle();
      expect(first.runner.run.mock.calls.filter((c) => c[0].name.endsWith('-snapshot'))).toHaveLength(1);
      expect(reports.filter((r) => r.status === 'running').length).toBeGreaterThanOrEqual(4);

      const done = final();
      const again = setup();

      reports = [];
      await again.service.handle('backupRun', backupRun());
      await again.service.idle();
      expect(again.runner.run).not.toHaveBeenCalled();
      expect(reports).toEqual([done]);
    });

    it('reports invalid commands as failed', async () => {
      const { service } = setup();

      await service.handle('backupRun', backupRun({ tags: { 'Bad Tag': 'x' } }));
      expect(final()).toMatchObject({ id: BACKUP, status: 'failed', error: expect.stringContaining('invalid') });
    });
  });

  describe('restoreRun', () => {
    it('volume: stops the containers using the volume, restores with replace, starts them again', async () => {
      const { service, runner, sessions } = setup();

      mounted = null;
      await service.handle('restoreRun', restoreRun({ mode: 'replace' }));
      await service.idle();

      expect(calls).toEqual([
        'job connect repository connect server',
        'stop c-store',
        'stop c-other',
        'volume mount',
        `job restore snapshot restore ${ROOT}`,
        'volume unmount',
        'start c-store',
        'start c-other',
      ]);
      expect(runner.run.mock.calls[1][0].cmd).toEqual([
        'snapshot',
        'restore',
        ROOT,
        '/volume',
        '--overwrite-files',
        '--overwrite-directories',
        '--overwrite-symlinks',
        '--delete-extra',
      ]);
      expect(sessions.begin).toHaveBeenCalledWith('shop/db/store/0');
      expect(sessions.end).toHaveBeenCalledWith('shop/db/store/0');
      expect(final()).toEqual({ id: RESTORE, operation: 'restore', status: 'done' });
    });

    it('volume: merge keeps extra files; containers start again after a failed restore', async () => {
      const { service, runner } = setup();

      failAt = 'job restore';
      await service.handle('restoreRun', restoreRun({ mode: 'merge' }));
      await service.idle();

      expect(runner.run.mock.calls[1][0].cmd).not.toContain('--delete-extra');
      expect(calls.slice(-2)).toEqual(['start c-store', 'start c-other']);
      expect(final()).toMatchObject({ status: 'failed', phase: 'restore' });
    });

    it('path: one file into the running volume, refusing to overwrite unless asked', async () => {
      const { service, runner } = setup();

      runResults['restore'] = { exitCode: 17, stdout: '', stderr: 'target exists', combined: 'target exists' };
      await service.handle('restoreRun', restoreRun({ kind: 'path', path: 'conf/app.yml', targetPath: 'app.yml' }));
      await service.idle();

      const spec = runner.run.mock.calls[1][0];

      expect(spec.entrypoint).toEqual(['/bin/sh', '-c']);
      expect(spec.cmd.slice(1)).toEqual([
        'sh',
        'app.yml',
        `${ROOT}/conf/app.yml`,
        '0',
        '--no-overwrite-files',
        '--no-overwrite-directories',
        '--no-overwrite-symlinks',
      ]);
      expect(spec.binds).toContain('/var/lib/loadweaver/volumes/lw-vol-shop.db.data:/volume');
      expect(runner.stop).not.toHaveBeenCalled();
      expect(final()).toMatchObject({
        status: 'failed',
        error: 'app.yml exists in the volume; restore with overwrite to replace it',
      });

      reports = [];
      runResults['restore'] = ok();
      await service.handle(
        'restoreRun',
        restoreRun({
          restore: '3e3f3b75-8d2e-4a6f-8b9c-2d3e4f5a6b7c',
          kind: 'path',
          path: 'conf/app.yml',
          overwrite: true,
        }),
      );
      await service.idle();
      expect(runner.run.mock.calls[3][0].cmd.slice(2, 5)).toEqual(['conf/app.yml', `${ROOT}/conf/app.yml`, '1']);
      expect(final()?.status).toBe('done');
    });

    it('path: traversal and absolute paths are refused by the contract', () => {
      for (const path of ['../etc/passwd', '/etc/passwd', 'a/../../b', 'a//b'])
        expect(restoreRunSchema.safeParse(restoreRun({ kind: 'path', path })).success).toBe(false);

      expect(restoreRunSchema.safeParse(restoreRun({ kind: 'path', path: 'a', targetPath: '../x' })).success).toBe(
        false,
      );
    });

    it('scratch: throw-away LUKS volume, restore, check, everything removed', async () => {
      const { service, runner } = setup();

      runResults['check'] = { exitCode: 0, stdout: 'ok', stderr: '', combined: 'ok' };
      await service.handle(
        'restoreRun',
        restoreRun({
          kind: 'scratch',
          sizeBytes: 1024 ** 3,
          check: { image: 'busybox', command: ['sh', '-c', 'test -f /data/x'], mountPath: '/data', timeoutSeconds: 60 },
        }),
      );
      await service.idle();

      const name = jobName(RESTORE);
      const mountpoint = join(dir, 'run', 'backups', name);

      expect(calls).toEqual([
        'job connect repository connect server',
        `lvcreate -q -y -V 1073741824b -T loadweaver/pool -n ${name}`,
        expect.stringMatching(/^cryptsetup luksFormat --type luks2 -q .*--key-file - \/dev\/loadweaver\//),
        `cryptsetup open --type luks2 --key-file - /dev/loadweaver/${name} ${name}-crypt`,
        `mkfs.ext4 -q -L ${name} /dev/mapper/${name}-crypt`,
        `mount -t ext4 -o nodev,nosuid /dev/mapper/${name}-crypt ${mountpoint}`,
        `job restore snapshot restore ${ROOT}`,
        'job check -c test -f /data/x',
        `umount ${mountpoint}`,
        `cryptsetup close ${name}-crypt`,
        `lvremove -y loadweaver/${name}`,
      ]);

      const check = runner.run.mock.calls[2][0];

      expect(check).toMatchObject({
        entrypoint: ['sh'],
        network: 'none',
        binds: [`${mountpoint}:/data`],
        timeoutMs: 60_000,
      });
      expect(reports.map((r) => `${r.status}:${r.phase ?? ''}`)).toEqual(['running:restore', 'running:check', 'done:']);
      expect(final()).toMatchObject({ status: 'done', check: { exitCode: 0, output: 'ok' } });
    });

    it('scratch: a failing check fails the restore test with its exit code and output tail', async () => {
      const { service } = setup();

      runResults['check'] = { exitCode: 3, stdout: '', stderr: '', combined: `${'x'.repeat(9000)}missing` };
      await service.handle(
        'restoreRun',
        restoreRun({
          kind: 'scratch',
          sizeBytes: 1024 ** 3,
          check: { image: 'busybox', command: ['false'], mountPath: '/data', timeoutSeconds: 5 },
        }),
      );
      await service.idle();

      const result = final();

      expect(result).toMatchObject({ status: 'failed', phase: 'check', error: 'check failed (exit 3)' });
      expect(result?.check?.exitCode).toBe(3);
      expect(result?.check?.output).toHaveLength(8192);
      expect(result?.check?.output.endsWith('missing')).toBe(true);
      expect(calls[calls.length - 1]).toMatch(/^lvremove/);
    });
  });

  describe('recover', () => {
    it('removes leftovers of a previous agent process', async () => {
      const { service, commands } = setup();

      commands.run.mockImplementation(async (command: string, args: readonly string[]) => {
        calls.push(`${command} ${args.join(' ')}`);

        return command === 'dmsetup'
          ? { stdout: 'lw-1000-crypt\nlw-bk-0123456789abcdef-crypt\n', stderr: '' }
          : { stdout: '', stderr: '' };
      });
      await mkdir(join(dir, 'run', 'lw-bk-0123456789abcdef-x'), { recursive: true });
      await service.recover();

      expect(calls).toEqual(
        expect.arrayContaining([
          'remove job containers',
          'cryptsetup close lw-bk-0123456789abcdef-crypt',
          'lvremove -y loadweaver/lw-bk-0123456789abcdef',
        ]),
      );
      expect(calls).not.toContain('cryptsetup close lw-1000-crypt');
      expect(calls).not.toContain('lvremove -y loadweaver/lw-1000');
      expect(await readdir(join(dir, 'run'))).toEqual([]);
    });
  });
});

describe('job helpers', () => {
  it('demultiplexes Docker streams', () => {
    const frame = (type: number, text: string) => {
      const header = Buffer.alloc(8);

      header[0] = type;
      header.writeUInt32BE(Buffer.byteLength(text), 4);

      return Buffer.concat([header, Buffer.from(text)]);
    };

    expect(demux(Buffer.concat([frame(1, '{"a":'), frame(2, 'warn\n'), frame(1, '1}')]))).toEqual({
      stdout: '{"a":1}',
      stderr: 'warn\n',
      combined: '{"a":warn\n1}',
    });
  });

  it('parses the snapshot manifest', () => {
    expect(parseSnapshotManifest(`noise\n${MANIFEST}`).rootEntry.obj).toBe(ROOT);
    expect(() => parseSnapshotManifest('{}')).toThrow('no snapshot manifest');
  });
});

describe('KopiaServerManager', () => {
  let dir: string;
  const server: BackupRepositoryServer = {
    scope: 'project-shop',
    port: 7701,
    s3: { address: '10.93.0.10', port: 3900, bucket: 'lw-backups', prefix: 'project-shop/' },
    tls: { certificatePem: 'CERT', privateKeyPem: 'KEY' },
    accessKeyId: 'GKaccess',
    secretAccessKey: 's3-secret-value',
    password: 'R'.repeat(43),
    controlPassword: 'C'.repeat(43),
    serverControlPassword: 'S'.repeat(43),
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-kopia-'));
  });

  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it('runs the server script with every secret in the environment only', () => {
    const spec = kopiaServerSpec(server, '/state/backups/project-shop', 'kopia:pinned');
    const args = JSON.stringify([spec.entrypoint, spec.cmd, spec.binds]);

    expect(spec).toMatchObject({
      name: 'lw-kopia-project-shop',
      component: 'backup-server',
      entrypoint: ['/bin/sh', '-c'],
      binds: ['/state/backups/project-shop/app:/app', '/state/backups/project-shop/tls:/tls:ro'],
    });
    expect(spec.cmd?.[0]).toContain('exec kopia server start --address=https://0.0.0.0:7701');
    expect(spec.env).toMatchObject({
      KOPIA_PASSWORD: server.password,
      AWS_ACCESS_KEY_ID: 'GKaccess',
      AWS_SECRET_ACCESS_KEY: 's3-secret-value',
      KOPIA_SERVER_CONTROL_PASSWORD: server.serverControlPassword,
    });
    expect(spec.env['LW_CONTROL_PASSWORD_HASH']).toMatch(/^[A-Za-z0-9+/=]+$/);
    // Go's soft limit below the container's hard limit (G5: the server was OOM-killed taking a 4 GiB VM disk).
    expect(spec.memoryBytes).toBe(1024 ** 3);
    expect(spec.env['GOMEMLIMIT']).toBe('819MiB');
    expect(kopiaGoMemoryLimit(2 * 1024 ** 3)).toBe('1638MiB');

    for (const secret of [
      server.password,
      's3-secret-value',
      'GKaccess',
      server.controlPassword,
      'S'.repeat(43),
      'KEY',
    ])
      expect(args).not.toContain(secret);

    // A rotated secret re-creates the container.
    expect(kopiaServerSpec({ ...server, password: 'Q'.repeat(43) }, '/x', 'kopia:pinned').hash).not.toBe(
      kopiaServerSpec(server, '/x', 'kopia:pinned').hash,
    );
    expect(() => kopiaServerSpec({ ...server, password: undefined }, '/x', 'i')).toThrow('without its secrets');
  });

  it('writes the TLS files 0600, removes servers and state no longer wanted', async () => {
    const containers = {
      ensure: jest.fn(async () => true),
      list: jest.fn(async () => ['lw-kopia-project-shop', 'lw-kopia-cluster']),
      remove: jest.fn(async () => true),
    };
    const manager = new KopiaServerManager(containers as never, { dir } as never);

    await mkdir(join(dir, 'backups', 'cluster', 'app'), { recursive: true });
    await mkdir(join(dir, 'backups', 'jobs'), { recursive: true });

    expect(await manager.apply({ repositories: [server] })).toBe(true);
    expect(await readFile(join(dir, 'backups', 'project-shop', 'tls', 'tls.key'), 'utf8')).toBe('KEY');
    expect((await stat(join(dir, 'backups', 'project-shop', 'tls', 'tls.key'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'backups', 'project-shop'))).mode & 0o777).toBe(0o700);
    expect(containers.remove).toHaveBeenCalledWith('lw-kopia-cluster');
    expect(containers.remove).not.toHaveBeenCalledWith('lw-kopia-project-shop');
    expect((await readdir(join(dir, 'backups'))).sort()).toEqual(['jobs', 'project-shop']);

    containers.list.mockResolvedValue(['lw-kopia-project-shop']);
    await manager.apply(undefined);
    expect(containers.remove).toHaveBeenCalledWith('lw-kopia-project-shop');
    expect(await readdir(join(dir, 'backups'))).toEqual(['jobs']);
  });
});
