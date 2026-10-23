import { mkdtempSync, rmSync } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import {
  applyPass,
  excludedPaths,
  fdPath,
  openTree,
  parseGetfattr,
  parsePassMeta,
  passTarFile,
  readPassTar,
  scanPass,
  TarWriter,
  unescapeGetfattr,
  type GuestManifest,
  type GuestSyncOps,
  type SyncMode,
} from './guest-sync';
import {
  bundledMigrationSupported,
  microvmMigrationSupport,
  packageVersion,
  parseImageLabels,
} from './microvm-migration';

/** xattrs from a table (the opaque flag for overlay tests); set ones are recorded. */
function opsOf(opaque: string[] = []): GuestSyncOps & { set: [string, string][] } {
  const set: [string, string][] = [];

  return {
    set,
    xattrs: async (paths) =>
      new Map(
        paths
          .filter((p) => opaque.some((name) => p.endsWith(`/${name}`)))
          .map((p) => [p, { 'trusted.overlay.opaque': Buffer.from('y') }]),
      ),
    setXattr: async (path, name) => {
      set.push([path, name]);
    },
    mkfifo: async (path) => {
      await writeFile(path, '');
    },
  };
}

describe('guest tree pre-copy (M7 W10b)', () => {
  let dir: string;
  let source: string;
  let target: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lw-guest-sync-'));
    source = join(dir, 'source');
    target = join(dir, 'target');
    await mkdir(source);
    await mkdir(target);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function pass(previous: GuestManifest, mode: SyncMode = 'plain', ops = opsOf()) {
    const root = await openTree(source);
    const file = join(dir, `pass-${Math.random().toString(36).slice(2)}.tar`);

    try {
      const result = await scanPass({ root, mode, previous, out: passTarFile(file), ops });
      const meta = parsePassMeta(JSON.parse(JSON.stringify(result.meta)));
      const into = await openTree(target);

      try {
        await applyPass({ root: fdPath(into), tar: readPassTar(file), meta, ops });
      } finally {
        await into.close();
      }

      return result;
    } finally {
      await root.close();
    }
  }

  async function tree(root: string, relative = ''): Promise<Record<string, string>> {
    const out: Record<string, string> = {};

    for (const name of (await readdir(join(root, relative))).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      const info = await lstat(join(root, path));

      if (info.isSymbolicLink()) out[path] = `-> ${await readlink(join(root, path))}`;
      else if (info.isDirectory()) {
        out[path] = `dir ${(info.mode & 0o7777).toString(8)}`;
        Object.assign(out, await tree(root, path));
      } else out[path] = `${(info.mode & 0o7777).toString(8)} ${await readFile(join(root, path), 'utf8')}`;
    }

    return out;
  }

  it("leaves the launcher's mount points out on both sides (bundled /guest, M7 F5)", async () => {
    const exclude = ['app', 'run/secrets/token'];

    // Source: the writable layer holds Docker's placeholders of the mount points (and, in tests, content below).
    await mkdir(join(source, 'app'), { recursive: true });
    await mkdir(join(source, 'run/secrets'), { recursive: true });
    await mkdir(join(source, 'etc'));
    await writeFile(join(source, 'app/inside'), 'never');
    await writeFile(join(source, 'run/secrets/token'), '');
    await writeFile(join(source, 'etc/conf'), 'c');

    const root = await openTree(source);
    const file = join(dir, 'pass.tar');
    const result = await scanPass({
      root,
      mode: 'overlay',
      previous: new Map(),
      out: passTarFile(file),
      ops: opsOf(),
      exclude,
    });

    await root.close();
    expect([...result.manifest.keys()].sort()).toEqual(['etc', 'etc/conf', 'run', 'run/secrets']);

    // Target: a pass from a peer that names mount points anyway — never written, deleted or deleted through.
    await mkdir(join(target, 'app'));
    await writeFile(join(target, 'app/volume-data'), 'v');
    await mkdir(join(target, 'run/secrets'), { recursive: true });
    await writeFile(join(target, 'run/secrets/token'), 'secret');
    await writeFile(join(target, 'stale'), 's');

    const all = await openTree(source);
    const unfiltered = join(dir, 'unfiltered.tar');
    const full = await scanPass({
      root: all,
      mode: 'plain',
      previous: new Map(),
      out: passTarFile(unfiltered),
      ops: opsOf(),
    });

    await all.close();

    const into = await openTree(target);

    try {
      const applied = await applyPass({
        root: fdPath(into),
        tar: readPassTar(unfiltered),
        meta: { ...full.meta, remove: ['app', 'run', 'stale'], opaque: { run: [] } },
        ops: opsOf(),
        exclude,
      });

      expect(applied.skipped).toBeGreaterThanOrEqual(4);
    } finally {
      await into.close();
    }

    expect(await tree(target)).toEqual({
      app: 'dir 755',
      'app/volume-data': '644 v',
      etc: expect.stringMatching(/^dir /),
      'etc/conf': '644 c',
      run: expect.stringMatching(/^dir /),
      'run/secrets': expect.stringMatching(/^dir /),
      'run/secrets/token': '644 secret',
    });
    expect(excludedPaths(['/app/']).isExcluded('app/x')).toBe(true);
    expect(excludedPaths(['app']).isExcluded('apple')).toBe(false);
    expect(excludedPaths(['run/secrets/token']).holdsExcluded('run')).toBe(true);
  });

  it('copies a tree, then only what changed, and deletes what went', async () => {
    await mkdir(join(source, 'etc/app'), { recursive: true, mode: 0o750 });
    await writeFile(join(source, 'etc/app/config'), 'v1', { mode: 0o640 });
    await writeFile(join(source, 'big'), Buffer.alloc(3 * 1024 * 1024 + 7, 7));
    await symlink('/etc/passwd', join(source, 'abs-link'));
    await writeFile(join(source, 'gone'), 'x');
    await link(join(source, 'etc/app/config'), join(source, 'hard'));

    const first = await pass(new Map());

    expect(await tree(target)).toEqual(await tree(source));
    expect((await stat(join(target, 'big'))).size).toBe(3 * 1024 * 1024 + 7);
    expect((await stat(join(target, 'hard'))).ino).toBe((await stat(join(target, 'etc/app/config'))).ino);
    // config (2) + gone (1); the hard link is no second copy.
    expect(first.bytes).toBe(3 * 1024 * 1024 + 7 + 3);

    // Second pass: one file changed, one deleted, one new; the big file isn't sent again.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(join(source, 'etc/app/config'), 'v2-longer');
    await unlink(join(source, 'gone'));
    await writeFile(join(source, 'new'), 'n');

    const second = await pass(first.manifest);

    expect(second.bytes).toBeLessThan(100);
    expect(second.meta.remove).toEqual(['gone']);
    expect(await tree(target)).toEqual(await tree(source));

    // A directory replaced by a file: its old subtree goes with one removal (etc/app), the file replaces etc.
    await rm(join(source, 'etc'), { recursive: true });
    await writeFile(join(source, 'etc'), 'now a file');

    const third = await pass(second.manifest);

    expect(third.meta.remove).toEqual(['etc/app']);
    expect(await tree(target)).toEqual(await tree(source));

    await rm(join(source, 'etc'));
    await mkdir(join(source, 'deep/a/b'), { recursive: true });
    await writeFile(join(source, 'deep/a/b/f'), 'f');

    const fourth = await pass(third.manifest);

    await rm(join(source, 'deep'), { recursive: true });

    const fifth = await pass(fourth.manifest);

    expect(fifth.meta.remove).toEqual(['deep']);
    expect(await tree(target)).toEqual(await tree(source));
  });

  it('removes the lower entries an opaque directory hides (overlay mode)', async () => {
    await mkdir(join(source, 'var/cache'), { recursive: true });
    await writeFile(join(source, 'var/cache/kept'), 'k');
    // On the target, the merged directory still shows the image's (lower) entries.
    await mkdir(join(target, 'var/cache'), { recursive: true });
    await writeFile(join(target, 'var/cache/from-image'), 'i');
    await writeFile(join(target, 'var/cache/kept'), 'old');

    const result = await pass(new Map(), 'overlay', opsOf(['cache']));

    expect(result.meta.opaque).toEqual({ 'var/cache': ['kept'] });
    expect(await readdir(join(target, 'var/cache'))).toEqual(['kept']);
    expect(await readFile(join(target, 'var/cache/kept'), 'utf8')).toBe('k');
  });

  it('never follows links: not on the source, not below a link on the target', async () => {
    const outside = join(dir, 'outside');

    await mkdir(outside);
    await writeFile(join(outside, 'secret'), 'host data');
    await symlink(outside, join(source, 'escape'));

    const result = await pass(new Map());

    expect(result.bytes).toBe(0);
    expect(await readlink(join(target, 'escape'))).toBe(outside);

    // A peer sending an entry below a link the target has: refused, nothing written outside.
    const file = join(dir, 'evil.tar');
    const writer = new TarWriter(passTarFile(file));
    const stats = { mode: 0o100644n, uid: BigInt(process.getuid?.() ?? 0), gid: BigInt(process.getgid?.() ?? 0) };

    await writer.entry({ path: 'escape/planted', flag: '0', stat: { ...stats, mtimeNs: 0n }, size: 1 } as never);
    await writer.end();

    const into = await openTree(target);

    await expect(
      applyPass({
        root: fdPath(into),
        tar: readPassTar(file),
        meta: parsePassMeta({ v: 1, remove: [], opaque: {} }),
        ops: opsOf(),
      }),
    ).rejects.toThrow(/non-directory/);
    await into.close();
    expect(await readdir(outside)).toEqual(['secret']);

    // Opening a tree through a link is refused as well.
    await expect(openTree(source, 'escape')).rejects.toThrow();
  });

  it('validates a peer pass description', () => {
    expect(() => parsePassMeta({ v: 1, remove: ['../x'], opaque: {} })).toThrow();
    expect(() => parsePassMeta({ v: 1, remove: [], opaque: { a: ['b/c'] } })).toThrow();
    expect(() => parsePassMeta({ v: 2, remove: [], opaque: {} })).toThrow();
    expect(parsePassMeta({ v: 1, remove: ['a/b'], opaque: { c: ['d'] }, skipped: 2 })).toEqual({
      v: 1,
      remove: ['a/b'],
      opaque: { c: ['d'] },
      skipped: 2,
    });
  });

  it('parses getfattr output with escaped names', () => {
    const parsed = parseGetfattr(
      '# file: /proc/1/fd/3/a\\040b\nuser.x=0sYWJj\ntrusted.overlay.opaque="y"\n\n# file: /proc/1/fd/3/c\n',
    );

    expect(unescapeGetfattr('caf\\303\\251')).toBe('café');
    expect(parsed.get('/proc/1/fd/3/a b')).toEqual({
      'user.x': Buffer.from('abc'),
      'trusted.overlay.opaque': Buffer.from('y'),
    });
    expect(parsed.get('/proc/1/fd/3/c')).toEqual({});
  });

  it('writes tars the layer reader accepts (pax names, sizes, xattrs)', async () => {
    const out = new PassThrough();
    const chunks: Buffer[] = [];

    out.on('data', (c: Buffer) => chunks.push(c));

    const writer = new TarWriter(out);
    const long = `${'d'.repeat(120)}/f`;

    await writer.entry({
      path: long,
      flag: '5',
      stat: { mode: 0o40755n, uid: 1000n, gid: 1000n, mtimeNs: 5_000_000_000n },
      xattrs: { 'user.k': Buffer.from([0, 1, 2]) },
    } as never);
    await writer.end();

    const { readTar } = await import('./rootfs-unpack');
    const entries = [];

    const data = Buffer.concat(chunks);

    for await (const { entry } of readTar(
      (async function* () {
        yield data;
      })(),
    ))
      entries.push(entry);

    expect(entries).toEqual([
      expect.objectContaining({ name: long, type: 'dir', mode: 0o755, uid: 1000, gid: 1000, mtime: 5 }),
    ]);
    expect(entries[0].xattrs['user.k']).toEqual(Buffer.from([0, 1, 2]));
  });
});

describe('launcher migration support (capabilities.microvmMigration)', () => {
  it('needs the generic mode, QEMU >= 10.0 and virtiofsd >= 1.13', () => {
    const labels = {
      'io.forepath.microvm.migration': 'generic,vm',
      'io.forepath.microvm.qemu-version': '1:10.0.13+ds-0+deb13u1',
      'io.forepath.microvm.virtiofsd-version': '1.13.2-1+deb13u1',
    };

    expect(packageVersion('1:10.0.13+ds-0+deb13u1')).toEqual([10, 0]);
    expect(microvmMigrationSupport(labels)).toEqual({
      generic: true,
      modes: ['generic', 'vm'],
      qemu: '1:10.0.13+ds-0+deb13u1',
      virtiofsd: '1.13.2-1+deb13u1',
    });
    expect(microvmMigrationSupport({ ...labels, 'io.forepath.microvm.virtiofsd-version': '1.10.1' }).generic).toBe(
      false,
    );
    expect(microvmMigrationSupport({ ...labels, 'io.forepath.microvm.qemu-version': '1:9.2.0' }).generic).toBe(false);
    expect(microvmMigrationSupport({ ...labels, 'io.forepath.microvm.migration': 'vm' }).generic).toBe(false);
    expect(microvmMigrationSupport({}).generic).toBe(false);
    expect(parseImageLabels('{"a":"b","n":1}')).toEqual({ a: 'b' });
    expect(parseImageLabels('null')).toEqual({});
    expect(parseImageLabels('sha256:1')).toEqual({});
  });

  it('knows bundled images whose launcher has the incoming mode (M7 F5)', () => {
    const labels = {
      'io.forepath.microvm.migration': 'generic,vm,bundled',
      'io.forepath.microvm.qemu-version': '1:10.0.13+ds-0+deb13u1',
      'io.forepath.microvm.virtiofsd-version': '1.13.2-1+deb13u1',
    };

    expect(bundledMigrationSupported(labels)).toBe(true);
    // Built on an older launcher: `generic,vm` only.
    expect(bundledMigrationSupported({ ...labels, 'io.forepath.microvm.migration': 'generic,vm' })).toBe(false);
    expect(bundledMigrationSupported({ ...labels, 'io.forepath.microvm.qemu-version': '1:9.2.0' })).toBe(false);
    expect(bundledMigrationSupported(undefined)).toBe(false);
  });
});
