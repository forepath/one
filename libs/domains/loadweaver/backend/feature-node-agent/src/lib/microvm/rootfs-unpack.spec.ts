import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

import { tarArchive, type TarFixtureEntry } from '../test-fixtures';
import {
  confinementCommands,
  decompressedLimit,
  keptXattr,
  LayerExtractor,
  layerCompression,
  LayerUnpackError,
  normalizeEntryPath,
  parsePax,
  planEntry,
  readTar,
  runUnpackLayerCommand,
  tarNumber,
  type TarEntry,
  unpackCommand,
  unpackLayerStream,
  type UnpackHostOps,
} from './rootfs-unpack';

const uid = process.getuid?.() ?? 0;
const gid = process.getgid?.() ?? 0;
const sha = (data: Buffer) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

function recordingOps(): UnpackHostOps & { calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    mknodWhiteout: async (path) => {
      calls.push(`mknod ${path}`);
    },
    setXattr: async (path, name, value) => {
      calls.push(`xattr ${path} ${name}=${value.toString()}`);
    },
    syncfs: async (path) => {
      calls.push(`syncfs ${path}`);
    },
  };
}

const own = (entries: TarFixtureEntry[]) => entries.map((e) => ({ uid, gid, ...e }));

async function extractAll(root: string, archive: Buffer, ops = recordingOps()) {
  const extractor = new LayerExtractor(root, ops);

  for await (const { entry, body } of readTar(Readable.from([archive]))) await extractor.extract(entry, body);

  await extractor.finish();

  return { extractor, ops };
}

const entry = (overrides: Partial<TarEntry>): TarEntry => ({
  name: 'x',
  type: 'file',
  mode: 0o644,
  uid: 0,
  gid: 0,
  size: 0,
  mtime: 0,
  linkname: '',
  xattrs: {},
  ...overrides,
});

describe('rootfs unpack (3.35)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lw-unpack-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('tar reading', () => {
    it('parses octal and GNU base-256 numbers, and pax records', () => {
      const block = Buffer.alloc(512);

      block.write('0000644\0', 100);
      expect(tarNumber(block, 100, 8)).toBe(0o644);
      block[124] = 0x80;
      block.writeUIntBE(5 * 1024 ** 3, 130, 6);
      expect(tarNumber(block, 124, 12)).toBe(5 * 1024 ** 3);
      block.write('12x', 136);
      expect(() => tarNumber(block, 136, 12)).toThrow(LayerUnpackError);

      const pax = parsePax(Buffer.from('18 path=some/long\n10 uid=42\n'));

      expect(pax.get('path')?.toString()).toBe('some/long');
      expect(pax.get('uid')?.toString()).toBe('42');
      expect(() => parsePax(Buffer.from('99 path=x\n'))).toThrow(LayerUnpackError);
    });

    it('reads entries with pax names, owners and xattrs and skips unread bodies', async () => {
      const archive = tarArchive([
        { name: 'short', data: 'ignored body', pax: { path: `${'d/'.repeat(60)}file`, uid: '1000' } },
        { name: 'bin/ping', data: 'ELF', mode: 0o4755, pax: { 'SCHILY.xattr.security.capability': 'cap' } },
      ]);
      const seen: TarEntry[] = [];

      for await (const { entry: e } of readTar(Readable.from([archive]))) seen.push(e);

      expect(seen.map((e) => e.name)).toEqual([`${'d/'.repeat(60)}file`, 'bin/ping']);
      expect(seen[0].uid).toBe(1000);
      expect(seen[1].mode).toBe(0o4755);
      expect(seen[1].xattrs['security.capability'].toString()).toBe('cap');
    });

    it('fails on corrupt headers, truncated archives and unsupported entry types', async () => {
      const archive = tarArchive([{ name: 'a', data: 'hello' }]);
      const corrupt = Buffer.from(archive);

      corrupt[0] = 0x41;

      const drain = async (data: Buffer) => {
        for await (const { body } of readTar(Readable.from([data]))) for await (const chunk of body()) void chunk;
      };

      await expect(drain(corrupt)).rejects.toThrow(/checksum/);
      await expect(drain(archive.subarray(0, 600))).rejects.toThrow(/unexpected end/);
      await expect(drain(tarArchive([{ name: 'sparse', type: 'S' }]))).rejects.toThrow(/unsupported tar entry type/);
    });
  });

  describe('entry rules', () => {
    it('normalises paths and refuses absolute ones and .. components', () => {
      expect(normalizeEntryPath('./usr//bin/./sh')).toBe('usr/bin/sh');
      expect(normalizeEntryPath('./')).toBeNull();
      expect(() => normalizeEntryPath('/etc/passwd')).toThrow(/absolute/);
      expect(() => normalizeEntryPath('a/../../etc')).toThrow(/'\.\.'/);
      expect(() => normalizeEntryPath('a\0b')).toThrow(/NUL/);
    });

    it('turns whiteouts into overlay whiteouts, drops devices, keeps link targets for the guest', () => {
      expect(planEntry(entry({ name: 'etc/.wh.passwd' }))).toEqual({ kind: 'whiteout', path: 'etc/passwd' });
      expect(planEntry(entry({ name: 'var/cache/.wh..wh..opq' }))).toEqual({ kind: 'opaque', dir: 'var/cache' });
      expect(planEntry(entry({ name: '.wh..wh..opq' }))).toEqual({ kind: 'opaque', dir: '' });
      expect(planEntry(entry({ name: '.wh..wh.plnk/123' }))).toEqual({ kind: 'file', path: '.wh..wh.plnk/123' });
      expect(planEntry(entry({ name: 'x/.wh..wh.aufs' })).kind).toBe('skip');
      expect(planEntry(entry({ name: 'dev/null', type: 'char' }))).toEqual({ kind: 'drop-device', path: 'dev/null' });
      expect(planEntry(entry({ name: 'dev/sda', type: 'block' })).kind).toBe('drop-device');
      expect(planEntry(entry({ name: 'run/fifo', type: 'fifo' })).kind).toBe('drop-device');
      expect(planEntry(entry({ name: 'lib64', type: 'symlink', linkname: '/usr/lib64' }))).toEqual({
        kind: 'symlink',
        path: 'lib64',
        target: '/usr/lib64',
      });
      expect(() => planEntry(entry({ name: 'x', type: 'hardlink', linkname: '../outside' }))).toThrow(LayerUnpackError);
      expect(() => planEntry(entry({ name: 'x/.wh.' }))).toThrow(/invalid whiteout/);
    });

    it('keeps only file capabilities and user xattrs', () => {
      expect(keptXattr('security.capability')).toBe(true);
      expect(keptXattr('user.mime')).toBe(true);
      expect(keptXattr('trusted.overlay.opaque')).toBe(false);
      expect(keptXattr('security.selinux')).toBe(false);
    });

    it('knows the layer media types and refuses foreign and unknown ones', () => {
      expect(layerCompression('application/vnd.oci.image.layer.v1.tar+gzip')).toBe('gzip');
      expect(layerCompression('application/vnd.docker.image.rootfs.diff.tar.gzip')).toBe('gzip');
      expect(layerCompression('application/vnd.oci.image.layer.v1.tar+zstd')).toBe('zstd');
      expect(layerCompression('application/vnd.oci.image.layer.v1.tar')).toBe('tar');
      expect(() => layerCompression('application/vnd.docker.image.rootfs.foreign.diff.tar.gzip')).toThrow(/foreign/);
      expect(() => layerCompression('application/vnd.oci.image.layer.nondistributable.v1.tar+gzip')).toThrow(
        /non-distributable/,
      );
      expect(() => layerCompression('application/x-iso9660')).toThrow(/unsupported/);
      expect(decompressedLimit(100, 16 * 1024 ** 3)).toBe(64 * 1024 ** 2);
      expect(decompressedLimit(1024 ** 3, 16 * 1024 ** 3)).toBe(8 * 1024 ** 3);
      expect(decompressedLimit(10 * 1024 ** 3, 16 * 1024 ** 3)).toBe(16 * 1024 ** 3);
    });
  });

  describe('extraction', () => {
    it('extracts files, directories, symlinks and same-layer hardlinks with modes (setuid kept)', async () => {
      await extractAll(
        root,
        tarArchive(
          own([
            { name: 'usr/', type: '5', mode: 0o755 },
            { name: 'usr/bin/su', data: 'su', mode: 0o4755 },
            { name: 'usr/bin/sudo', type: '1', linkname: 'usr/bin/su' },
            { name: 'bin', type: '2', linkname: 'usr/bin' },
            { name: 'etc/os-release', data: 'ID=test\n', mtime: 1_600_000_000 },
          ]),
        ),
      );

      expect((await stat(join(root, 'usr/bin/su'))).mode & 0o7777).toBe(0o4755);
      expect((await stat(join(root, 'usr/bin/sudo'))).ino).toBe((await stat(join(root, 'usr/bin/su'))).ino);
      expect(await readlink(join(root, 'bin'))).toBe('usr/bin');
      expect(await readFile(join(root, 'etc/os-release'), 'utf8')).toBe('ID=test\n');
      expect((await stat(join(root, 'etc/os-release'))).mtimeMs).toBe(1_600_000_000_000);
      // Parents the tar didn't list are created as plain directories.
      expect((await lstat(join(root, 'etc'))).isDirectory()).toBe(true);
    });

    it('refuses paths through a symlink (no host file is ever reached through the layer)', async () => {
      await expect(
        extractAll(
          root,
          tarArchive(
            own([
              { name: 'etc', type: '2', linkname: '/etc' },
              { name: 'etc/passwd', data: 'root::0:0::/:/bin/sh' },
            ]),
          ),
        ),
      ).rejects.toThrow(/goes through the symlink etc/);
    });

    it('refuses hardlinks to anything not extracted from the same layer', async () => {
      await expect(
        extractAll(root, tarArchive(own([{ name: 'shadow', type: '1', linkname: 'etc/shadow' }]))),
      ).rejects.toThrow(/not a file extracted from this layer/);
    });

    it('replaces an existing symlink instead of writing through it', async () => {
      await extractAll(
        root,
        tarArchive(
          own([
            { name: 'target', data: 'original' },
            { name: 'link', type: '2', linkname: 'target' },
            { name: 'link', data: 'replaced' },
          ]),
        ),
      );

      expect(await readFile(join(root, 'target'), 'utf8')).toBe('original');
      expect((await lstat(join(root, 'link'))).isFile()).toBe(true);
    });

    it('creates overlay whiteouts and opaque markers, drops device nodes, filters xattrs', async () => {
      const { extractor, ops } = await extractAll(
        root,
        tarArchive(
          own([
            { name: 'etc/.wh.motd' },
            { name: 'var/cache/.wh..wh..opq' },
            { name: 'kept', data: 'x' },
            { name: '.wh.kept' },
            { name: 'dev/null', type: '3' },
            {
              name: 'bin/ping',
              data: 'ELF',
              pax: {
                'SCHILY.xattr.security.capability': 'cap',
                'SCHILY.xattr.trusted.evil': 'y',
                'SCHILY.xattr.security.selinux': 'z',
                'SCHILY.xattr.user.note': 'n',
              },
            },
          ]),
        ),
      );

      expect(ops.calls).toEqual([
        `mknod ${join(root, 'etc/motd')}`,
        `xattr ${join(root, 'var/cache')} trusted.overlay.opaque=y`,
        `xattr ${join(root, 'bin/ping')} security.capability=cap`,
        `xattr ${join(root, 'bin/ping')} user.note=n`,
      ]);
      // The same layer's entry wins over its whiteout.
      expect(await readFile(join(root, 'kept'), 'utf8')).toBe('x');
      expect(extractor.counts).toEqual({ entries: 6, droppedDevices: 1, whiteouts: 2 });
      await expect(lstat(join(root, 'dev/null'))).rejects.toThrow();
    });
  });

  describe('layer streams', () => {
    it('computes both digests of a gzip layer and syncs the staging dir', async () => {
      const tar = tarArchive(own([{ name: 'hello.txt', data: 'hello' }]));
      const blob = gzipSync(tar);
      const ops = recordingOps();
      const result = await unpackLayerStream(Readable.from([blob]), root, {
        mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
        size: blob.length,
        maxBytes: 1024 ** 3,
        ops,
      });

      expect(result).toEqual({
        digest: sha(blob),
        diffId: sha(tar),
        bytes: tar.length,
        entries: 1,
        droppedDevices: 0,
        whiteouts: 0,
      });
      expect(ops.calls).toEqual([`syncfs ${root}`]);
      expect(await readFile(join(root, 'hello.txt'), 'utf8')).toBe('hello');
    });

    it('stops decompression bombs at the layer bound', async () => {
      const tar = tarArchive(own([{ name: 'zeros', data: Buffer.alloc(512 * 1024) }]));
      const blob = gzipSync(tar);

      await expect(
        unpackLayerStream(Readable.from([blob]), root, {
          mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
          size: 1024,
          maxBytes: 256 * 1024,
          ops: recordingOps(),
        }),
      ).rejects.toThrow(/exceeds its limit of 262144 bytes/);
    });

    it('refuses foreign layers before reading anything', async () => {
      await expect(
        unpackLayerStream(Readable.from([Buffer.alloc(0)]), root, {
          mediaType: 'application/vnd.oci.image.layer.nondistributable.v1.tar',
          size: 1,
          maxBytes: 1,
          ops: recordingOps(),
        }),
      ).rejects.toThrow(/non-distributable/);
    });
  });

  describe('confinement', () => {
    const mountinfo = [
      '22 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw',
      '23 22 0:5 / /proc rw shared:2 - proc proc rw',
      '24 22 8:2 / /var/lib rw shared:3 - xfs /dev/sda2 rw',
      '25 22 0:20 / /run rw shared:4 - tmpfs tmpfs rw',
      '26 22 0:21 / /mnt/with\\040space rw - tmpfs tmpfs rw',
    ].join('\n');

    it('re-mounts everything read-only except the staging dir, in its own namespaces', () => {
      expect(confinementCommands(mountinfo, '/var/lib/loadweaver/vmroot/staging/abc')).toEqual([
        ['mount', ['--make-rprivate', '/']],
        ['mount', ['--bind', '/var/lib/loadweaver/vmroot/staging/abc', '/var/lib/loadweaver/vmroot/staging/abc']],
        ['mount', ['-o', 'remount,bind,ro', '/']],
        ['mount', ['-o', 'remount,bind,ro', '/run']],
        ['mount', ['-o', 'remount,bind,ro', '/var/lib']],
        ['mount', ['-o', 'remount,bind,ro', '/mnt/with space']],
      ]);
      expect(
        unpackCommand(['/usr/bin/loadweaver-agent'], {
          staging: '/s',
          mediaType: 'application/vnd.oci.image.layer.v1.tar',
          size: 10,
          maxBytes: 20,
        }),
      ).toEqual([
        'unshare',
        [
          '--mount',
          '--pid',
          '--fork',
          '--kill-child',
          '/usr/bin/loadweaver-agent',
          'unpack-layer',
          '--staging',
          '/s',
          '--media-type',
          'application/vnd.oci.image.layer.v1.tar',
          '--size',
          '10',
          '--max-bytes',
          '20',
        ],
      ]);
    });

    it('confines itself before unpacking and prints the result', async () => {
      const tar = tarArchive(own([{ name: 'a', data: 'b' }]));
      const commands = { run: jest.fn(async () => ({ stdout: '', stderr: '' })) };
      let out = '';

      await runUnpackLayerCommand(
        { staging: root, mediaType: 'application/vnd.oci.image.layer.v1.tar', size: tar.length, maxBytes: 1024 ** 2 },
        {
          stdin: Readable.from([tar]),
          stdout: { write: (s: string) => (out += s) } as never,
          readMountinfo: async () => mountinfo,
        },
        commands as never,
      );

      expect(commands.run.mock.calls[0]).toEqual(['mount', ['--make-rprivate', '/']]);
      expect(commands.run).toHaveBeenCalledWith('sync', ['-f', root], expect.anything());
      expect(JSON.parse(out)).toMatchObject({ diffId: sha(tar), entries: 1 });
      await expect(
        runUnpackLayerCommand(
          { staging: 'relative', mediaType: 'x', size: 1, maxBytes: 1 },
          { stdin: Readable.from([]), stdout: process.stdout, readMountinfo: async () => '' },
          commands as never,
        ),
      ).rejects.toThrow(/absolute/);
    });
  });
});
