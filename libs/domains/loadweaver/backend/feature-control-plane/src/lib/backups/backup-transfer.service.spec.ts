import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { ForbiddenException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import * as tar from 'tar';

import {
  acceptedArchiveEntry,
  BackupTransferService,
  backupArchiveMaxBytes,
  backupStagingDir,
  byteLimit,
  DEFAULT_BACKUP_ARCHIVE_MAX_BYTES,
  plainTarIssue,
  safeArchiveMode,
} from './backup-transfer.service';
import { parseKopiaSnapshotCreate } from './kopia-cli';

const operator = { clusterRole: undefined, projects: new Map([['shop', 'operator']]), isApiKey: false, userId: 'u1' };
const viewer = { clusterRole: undefined, projects: new Map([['shop', 'viewer']]), isApiKey: false, userId: 'u2' };

function setup(options: { caller?: unknown; backup?: Record<string, unknown> | null; placement?: boolean } = {}) {
  const saved: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const backupRepo = {
    findOne: jest.fn(async () => (options.backup === undefined ? null : options.backup)),
    exists: jest.fn(async () => false),
    find: jest.fn(async () => []),
    create: (v: Record<string, unknown>) => v,
    save: jest.fn(async (v: Record<string, unknown>) => {
      const row = { id: 'new-backup', ...v };

      saved.push(row);

      return row;
    }),
  };
  const placementRepo = {
    exists: jest.fn(async () => options.placement !== false),
    find: jest.fn(async () => [{ id: 'shop/web/data' }, { id: 'shop/db/pg' }]),
  };
  const resourceRepo = { findOne: jest.fn(async () => ({ labels: { tier: 'web' } })) };
  const repoFor = (entity: { name: string }) =>
    entity.name === 'BackupEntity'
      ? backupRepo
      : entity.name === 'VolumePlacementEntity'
        ? placementRepo
        : resourceRepo;
  const manager = { getRepository: repoFor };
  const dataSource = {
    getRepository: repoFor,
    transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) => await fn(manager)),
  };
  const extracted: Record<string, string> = {};
  const cli = {
    restoreArchive: jest.fn(async (_c: unknown, _o: string, file: string) => {
      await writeFile(file, 'TAR-BYTES');
    }),
    snapshotDirectory: jest.fn(async (_c: unknown, dir: string) => {
      for (const name of ['a.txt']) {
        const path = join(dir, name);

        if (existsSync(path)) extracted[name] = readFileSync(path, 'utf8');
      }

      extracted['link-present'] = String(existsSync(join(dir, 'link')));

      return { id: 'manifest-1', rootEntry: { obj: 'kroot', summ: { size: 42, files: 2 } } };
    }),
  };
  const repositories = {
    cli,
    controlConnection: jest.fn(async () => ({ kind: 'server' })),
    ensure: jest.fn(async () => ({ keyGeneration: 3 })),
  };
  const scheduler = { startBackup: jest.fn(async () => ({ id: 'b' })) };
  const backups = { get: jest.fn(async (_r: unknown, id: string) => ({ id })) };
  const audit = {
    record: jest.fn(async (_m: unknown, entry: Record<string, unknown>) => audits.push(entry)),
    recordStandalone: jest.fn(async (entry: Record<string, unknown>) => audits.push(entry)),
  };
  const access = { caller: jest.fn(async () => options.caller ?? operator) };
  const service = new BackupTransferService(
    dataSource as never,
    access as never,
    repositories as never,
    scheduler as never,
    backups as never,
    audit as never,
  );

  return { service, saved, audits, cli, scheduler, extracted };
}

async function tarOf(files: Record<string, string>, extra?: (dir: string) => Promise<void>): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'lw-tar-src-'));

  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content);
    }

    await extra?.(dir);

    const chunks: Buffer[] = [];
    const stream = tar.c({ cwd: dir, portable: true }, await readdir(dir));

    for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);

    return Buffer.concat(chunks);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A raw ustar archive with hand-set header fields (declared size / mode), `data` may be shorter than `size`. */
function rawTar(entries: { path: string; size: number; mode: number; data: Buffer }[]): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const header = Buffer.alloc(512);

    new tar.Header({
      path: entry.path,
      type: 'File',
      size: entry.size,
      mode: entry.mode,
      mtime: new Date(0),
      uid: 0,
      gid: 0,
    }).encode(header, 0);
    blocks.push(header, entry.data, Buffer.alloc((512 - (entry.data.length % 512)) % 512));
  }

  blocks.push(Buffer.alloc(1024));

  return Buffer.concat(blocks);
}

describe('cross-cluster backup transfer (3.24)', () => {
  const succeeded = {
    id: '6f1f2c43-0000-4000-8000-000000000001',
    scope: 'project-shop',
    project: 'shop',
    resource: 'shop/web/data',
    status: 'succeeded',
    rootObject: 'kabc',
    deletedAt: null,
    bytes: 100,
  };

  it('exports a project backup as a tar archive for operators, audited, and removes the temp file', async () => {
    const { service, audits, cli } = setup({ backup: succeeded });
    const archive = await service.exportArchive(undefined, succeeded.id);
    const chunks: Buffer[] = [];

    for await (const chunk of archive.stream as AsyncIterable<Buffer>) chunks.push(chunk);

    expect(Buffer.concat(chunks).toString()).toBe('TAR-BYTES');
    expect(archive.bytes).toBe(9);
    expect(archive.filename).toBe(`shop_web_data-${succeeded.id}.tar`);
    expect(cli.restoreArchive).toHaveBeenCalledWith({ kind: 'server' }, 'kabc', expect.stringMatching(/backup\.tar$/));
    expect(audits[0]).toMatchObject({ action: 'backup.exported', target: `backup/${succeeded.id}`, project: 'shop' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(existsSync(cli.restoreArchive.mock.calls[0][2])).toBe(false);
  });

  it('refuses viewers, cluster-scoped and unavailable backups', async () => {
    await expect(setup({ backup: succeeded, caller: viewer }).service.exportArchive(undefined, 'x')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      setup({ backup: { ...succeeded, project: null } }).service.exportArchive(undefined, 'x'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      setup({ backup: { ...succeeded, deletedAt: new Date() } }).service.exportArchive(undefined, 'x'),
    ).rejects.toThrow('not available');
  });

  it('imports a tar archive as a new catalog entry without policy and audits the source', async () => {
    const { service, saved, audits, extracted } = setup();
    const body = await tarOf({ 'a.txt': 'alpha' });
    const result = await service.importArchive(
      undefined,
      { volume: 'shop/web/data', sourceCluster: 'eu-1', sourceBackup: succeeded.id },
      Readable.from([body]),
    );

    expect(result).toEqual({ id: 'new-backup' });
    expect(extracted['a.txt']).toBe('alpha');
    expect(saved[0]).toMatchObject({
      scope: 'project-shop',
      project: 'shop',
      resource: 'shop/web/data',
      policy: null,
      status: 'succeeded',
      snapshotId: 'manifest-1',
      rootObject: 'kroot',
      keyGeneration: 3,
      bytes: 42,
      files: 2,
    });
    expect(audits[0]).toMatchObject({
      action: 'backup.imported',
      details: { sourceCluster: 'eu-1', sourceBackup: succeeded.id, resource: 'shop/web/data' },
    });
  });

  it('keeps symbolic links inside the snapshot (they are data, never followed)', async () => {
    const { service, extracted } = setup();
    const body = await tarOf({ 'a.txt': 'alpha' }, async (dir) => await symlink('a.txt', join(dir, 'link')));

    await service.importArchive(undefined, { volume: 'shop/web/data' }, Readable.from([body]));

    expect(extracted['link-present']).toBe('true');
  });

  it('validates the volume, the labels, access and the archive', async () => {
    const { service } = setup();

    await expect(service.importArchive(undefined, { volume: '../x' }, Readable.from([]))).rejects.toThrow('volume is');
    await expect(
      service.importArchive(undefined, { volume: 'shop/web/data', sourceCluster: 'a b' }, Readable.from([])),
    ).rejects.toThrow('invalid source label');
    await expect(
      setup({ caller: viewer }).service.importArchive(undefined, { volume: 'shop/web/data' }, Readable.from([])),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      setup({ placement: false }).service.importArchive(undefined, { volume: 'shop/web/data' }, Readable.from([])),
    ).rejects.toThrow('volume not found');
    await expect(service.importArchive(undefined, { volume: 'shop/web/data' }, Readable.from([]))).rejects.toThrow(
      'empty archive',
    );
    await expect(
      service.importArchive(undefined, { volume: 'shop/web/data' }, Readable.from([Buffer.from('not a tar archive')])),
    ).rejects.toThrow('invalid tar archive');
  });

  it('refuses compressed archives before extracting (decompression bomb)', async () => {
    const { service, cli } = setup();
    const gzipped = gzipSync(await tarOf({ 'a.txt': 'alpha' }));

    await expect(
      service.importArchive(undefined, { volume: 'shop/web/data' }, Readable.from([gzipped])),
    ).rejects.toThrow('compressed archives are not accepted');
    expect(cli.snapshotDirectory).not.toHaveBeenCalled();
  });

  it('caps the running total of the declared entry sizes', async () => {
    const previous = process.env['LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES'];

    process.env['LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES'] = '4096';

    try {
      const { service, cli } = setup();
      // 2.5 KiB upload whose header claims 1 MiB.
      const body = rawTar([{ path: 'big.bin', size: 1024 * 1024, mode: 0o644, data: Buffer.alloc(1024, 1) }]);

      await expect(
        service.importArchive(undefined, { volume: 'shop/web/data' }, Readable.from([body])),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(cli.snapshotDirectory).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env['LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES'];
      else process.env['LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES'] = previous;
    }
  });

  it('strips setuid / setgid / sticky bits from extracted files', async () => {
    const { service, cli } = setup();
    const modes: Record<string, number> = {};

    cli.snapshotDirectory.mockImplementationOnce(async (_c: unknown, dir: string) => {
      modes['tool'] = statSync(join(dir, 'tool')).mode & 0o7777;

      return { id: 'manifest-1', rootEntry: { obj: 'kroot', summ: { size: 2, files: 1 } } };
    });

    const data = Buffer.from('#!');

    await service.importArchive(
      undefined,
      { volume: 'shop/web/data' },
      Readable.from([rawTar([{ path: 'tool', size: data.length, mode: 0o7755, data }])]),
    );

    expect(modes['tool'] & 0o7000).toBe(0);
    expect(modes['tool'] & 0o700).toBe(0o700);
  });

  it('backs up every placed volume for cluster admins only (final backup)', async () => {
    const admin = { clusterRole: 'cluster-admin', projects: new Map(), isApiKey: true };
    const { service, scheduler, audits } = setup({ caller: admin });

    await expect(service.backupAll(undefined)).resolves.toEqual({
      started: ['shop/web/data', 'shop/db/pg'],
      skipped: [],
    });
    expect(scheduler.startBackup).toHaveBeenCalledWith(
      { id: 'shop/web/data', project: 'shop', deployment: 'web', volume: 'data', deploymentLabels: { tier: 'web' } },
      { key: null, hooks: true },
    );
    expect(audits[0]).toMatchObject({ action: 'backup.all-started' });
    await expect(setup({ caller: operator }).service.backupAll(undefined)).rejects.toThrow(ForbiddenException);
  });
});

describe('transfer helpers', () => {
  it('caps the archive size', async () => {
    expect(backupArchiveMaxBytes({})).toBe(DEFAULT_BACKUP_ARCHIVE_MAX_BYTES);
    expect(backupArchiveMaxBytes({ LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES: '1024' })).toBe(1024);
    expect(backupArchiveMaxBytes({ LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES: 'x' })).toBe(DEFAULT_BACKUP_ARCHIVE_MAX_BYTES);

    const limit = byteLimit(4);
    const errors: unknown[] = [];

    limit.on('error', (e) => errors.push(e));
    limit.write(Buffer.from('abc'));
    limit.write(Buffer.from('de'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(errors[0]).toBeInstanceOf(PayloadTooLargeException);
  });

  it('accepts plain ustar only, masks modes and stages in the configured directory', () => {
    const ustar = rawTar([{ path: 'a', size: 1, mode: 0o644, data: Buffer.from('a') }]).subarray(0, 512);

    expect(plainTarIssue(ustar)).toBeNull();
    // GNU tar magic (`ustar  \0`) is fine too.
    expect(
      plainTarIssue(Buffer.concat([ustar.subarray(0, 257), Buffer.from('ustar  \0'), ustar.subarray(265)])),
    ).toBeNull();
    expect(plainTarIssue(gzipSync(Buffer.alloc(1024)))).toMatch(/compressed/);
    expect(plainTarIssue(Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.alloc(600)]))).toMatch(
      /compressed/,
    );
    expect(plainTarIssue(Buffer.alloc(512))).toMatch(/ustar/);
    expect(safeArchiveMode(0o6755)).toBe(0o755);
    expect(safeArchiveMode(0o1777)).toBe(0o777);
    expect(backupStagingDir({ LOADWEAVER_BACKUP_STAGING_DIR: '/var/lib/loadweaver/staging' })).toBe(
      '/var/lib/loadweaver/staging',
    );
    expect(backupStagingDir({})).toBe(tmpdir());
  });

  it('accepts files, directories and symlinks only', () => {
    expect(acceptedArchiveEntry('a/b.txt', 'File')).toBe(true);
    expect(acceptedArchiveEntry('a/', 'Directory')).toBe(true);
    expect(acceptedArchiveEntry('l', 'SymbolicLink')).toBe(true);
    expect(acceptedArchiveEntry('h', 'Link')).toBe(false);
    expect(acceptedArchiveEntry('dev', 'CharacterDevice')).toBe(false);
    expect(acceptedArchiveEntry('a/../../etc', 'File')).toBe(false);
  });

  it('parses the manifest of kopia snapshot create', () => {
    const manifest = { id: 'm1', rootEntry: { obj: 'k1', summ: { size: 5, files: 1 } } };

    expect(parseKopiaSnapshotCreate(JSON.stringify(manifest))).toEqual(manifest);
    expect(parseKopiaSnapshotCreate(`Snapshotting ...\n${JSON.stringify(manifest)}\n`)).toEqual(manifest);
    expect(() => parseKopiaSnapshotCreate('nothing')).toThrow('no snapshot');
  });
});
