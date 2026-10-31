import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runFileRequest } from './confined-fs';

describe('confined file operations', () => {
  let base: string;
  let root: string;
  const target = { kind: 'volume' as const, volume: 'shop/store/data' };

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'lw-fs-'));
    root = join(base, 'root');
    await mkdir(join(root, 'dir'), { recursive: true });
    await writeFile(join(root, 'dir', 'a.txt'), 'hello world');
    await writeFile(join(base, 'outside.txt'), 'secret');
    await symlink(join(base, 'outside.txt'), join(root, 'escape'));
    await symlink('..', join(root, 'escape-dir'));
    await symlink('dir/a.txt', join(root, 'inner'));
    // Absolute links resolve inside the root, as the container sees them.
    await symlink('/dir/a.txt', join(root, 'absolute'));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('lists and reads within the root, in ranges', async () => {
    const list = await runFileRequest(root, { op: 'list', target, path: '/' });

    expect(list.entries?.map((e) => [e.name, e.type])).toEqual([
      ['dir', 'directory'],
      ['absolute', 'symlink'],
      ['escape', 'symlink'],
      ['escape-dir', 'symlink'],
      ['inner', 'symlink'],
    ]);

    const read = await runFileRequest(root, { op: 'read', target, path: '/dir/a.txt', offset: 6, length: 5 });

    expect(Buffer.from(read.data ?? '', 'base64').toString()).toBe('world');
    // Links inside the root are followed.
    expect(
      Buffer.from(
        (await runFileRequest(root, { op: 'read', target, path: '/inner', offset: 0, length: 5 })).data ?? '',
        'base64',
      ).toString(),
    ).toBe('hello');
    expect(
      Buffer.from(
        (await runFileRequest(root, { op: 'read', target, path: '/absolute', offset: 0, length: 5 })).data ?? '',
        'base64',
      ).toString(),
    ).toBe('hello');
  });

  it('never leaves the root', async () => {
    for (const path of ['/escape', '/escape-dir/outside.txt', '/../outside.txt', '/dir/../../outside.txt'])
      expect((await runFileRequest(root, { op: 'read', target, path, offset: 0, length: 10 })).ok).toBe(false);

    expect((await runFileRequest(root, { op: 'list', target, path: '/escape-dir' })).error?.code).toBe('denied');
    // Writing through a link out of the root is refused, the link isn't followed.
    expect(
      (
        await runFileRequest(root, {
          op: 'write',
          target,
          path: '/escape',
          offset: 0,
          data: Buffer.from('x').toString('base64'),
          truncate: true,
        })
      ).ok,
    ).toBe(false);
    expect(await readFile(join(base, 'outside.txt'), 'utf8')).toBe('secret');
    // Deleting a link removes the link only.
    expect((await runFileRequest(root, { op: 'delete', target, path: '/escape-dir' })).ok).toBe(true);
    expect(await readFile(join(base, 'outside.txt'), 'utf8')).toBe('secret');
    expect((await runFileRequest(root, { op: 'delete', target, path: '/' })).error?.code).toBe('denied');
    expect((await runFileRequest(root, { op: 'stat', target, path: '/../../etc/passwd' })).error).toEqual({
      code: 'denied',
      message: 'path outside the root',
    });
  });

  it('writes in chunks, creates, moves and copies with conflict handling', async () => {
    const chunk = (data: string, offset: number, truncate: boolean) =>
      runFileRequest(root, {
        op: 'write',
        target,
        path: '/dir/b.txt',
        offset,
        data: Buffer.from(data).toString('base64'),
        truncate,
      });

    expect((await chunk('abc', 0, true)).ok).toBe(true);
    expect((await chunk('def', 3, false)).ok).toBe(true);
    expect(await readFile(join(root, 'dir', 'b.txt'), 'utf8')).toBe('abcdef');
    expect((await runFileRequest(root, { op: 'mkdir', target, path: '/new' })).ok).toBe(true);
    expect((await runFileRequest(root, { op: 'mkdir', target, path: '/new' })).error?.code).toBe('exists');
    expect(
      (await runFileRequest(root, { op: 'copy', target, path: '/dir', to: '/new/dir', overwrite: false })).ok,
    ).toBe(true);
    expect(
      (await runFileRequest(root, { op: 'copy', target, path: '/dir', to: '/new/dir', overwrite: false })).error?.code,
    ).toBe('exists');
    expect(
      (await runFileRequest(root, { op: 'move', target, path: '/dir/b.txt', to: '/dir/a.txt', overwrite: true })).ok,
    ).toBe(true);
    expect(await readFile(join(root, 'dir', 'a.txt'), 'utf8')).toBe('abcdef');
    expect(
      (await runFileRequest(root, { op: 'move', target, path: '/dir', to: '/dir/sub', overwrite: false })).error?.code,
    ).toBe('denied');
    expect((await runFileRequest(root, { op: 'stat', target, path: '/nope' })).error?.code).toBe('not-found');
  });

  it('resolves every component by descriptor, so a directory swapped for a link never leads out of the root', async () => {
    await mkdir(join(base, 'host'));
    await writeFile(join(base, 'host', 'a.txt'), 'host file');
    // What a container process can do between a check and the operation: replace a parent directory with a link.
    await rename(join(root, 'dir'), join(root, 'dir.old'));
    await symlink(join(base, 'host'), join(root, 'dir'));

    const read = await runFileRequest(root, { op: 'read', target, path: '/dir/a.txt', offset: 0, length: 20 });

    expect(read.ok).toBe(false);
    expect(
      (
        await runFileRequest(root, {
          op: 'write',
          target,
          path: '/dir/a.txt',
          offset: 0,
          data: Buffer.from('x').toString('base64'),
          truncate: true,
        })
      ).ok,
    ).toBe(false);
    expect((await runFileRequest(root, { op: 'delete', target, path: '/dir/a.txt' })).ok).toBe(false);
    expect(
      (await runFileRequest(root, { op: 'move', target, path: '/dir/a.txt', to: '/stolen', overwrite: false })).ok,
    ).toBe(false);
    expect(await readFile(join(base, 'host', 'a.txt'), 'utf8')).toBe('host file');
    // A relative link that climbs out is refused.
    await symlink('../host', join(root, 'up'));
    expect((await runFileRequest(root, { op: 'list', target, path: '/up' })).error?.code).toBe('denied');
    // Links that stay inside still work as intermediate components.
    await rm(join(root, 'dir'));
    await symlink('dir.old', join(root, 'dir'));
    expect((await runFileRequest(root, { op: 'stat', target, path: '/dir/a.txt' })).entry?.size).toBe(11);
  });

  it('deletes and copies trees without following links out of the root', async () => {
    await mkdir(join(root, 'tree', 'sub'), { recursive: true });
    await writeFile(join(root, 'tree', 'sub', 'f.txt'), 'f');
    await symlink(base, join(root, 'tree', 'out'));
    expect((await runFileRequest(root, { op: 'copy', target, path: '/tree', to: '/tree2', overwrite: false })).ok).toBe(
      true,
    );
    expect(await readFile(join(root, 'tree2', 'sub', 'f.txt'), 'utf8')).toBe('f');
    expect((await lstat(join(root, 'tree2', 'out'))).isSymbolicLink()).toBe(true);
    expect((await runFileRequest(root, { op: 'delete', target, path: '/tree' })).ok).toBe(true);
    expect(await readFile(join(base, 'outside.txt'), 'utf8')).toBe('secret');
    await expect(lstat(join(root, 'tree'))).rejects.toThrow();
  });

  it('refuses FIFOs and other special files instead of blocking on them', async () => {
    execFileSync('mkfifo', [join(root, 'pipe')]);

    expect((await runFileRequest(root, { op: 'read', target, path: '/pipe', offset: 0, length: 10 })).error).toEqual({
      code: 'denied',
      message: 'not a regular file',
    });
    expect(
      (
        await runFileRequest(root, {
          op: 'write',
          target,
          path: '/pipe',
          offset: 0,
          data: Buffer.from('x').toString('base64'),
          truncate: true,
        })
      ).error?.code,
    ).toBe('denied');
    // Copies skip them (no reader would ever come).
    await rename(join(root, 'pipe'), join(root, 'dir', 'pipe'));
    expect(
      (await runFileRequest(root, { op: 'copy', target, path: '/dir', to: '/dir-copy', overwrite: false })).ok,
    ).toBe(true);
    await expect(lstat(join(root, 'dir-copy', 'pipe'))).rejects.toThrow();
    expect(await readFile(join(root, 'dir-copy', 'a.txt'), 'utf8')).toBe('hello world');
  });

  it('never loses the source when moving or copying onto itself or its parent', async () => {
    for (const to of ['/dir/a.txt', '/dir/./a.txt', '/dir/sub/../a.txt'])
      expect((await runFileRequest(root, { op: 'move', target, path: '/dir/a.txt', to, overwrite: true })).ok).toBe(
        true,
      );

    expect(await readFile(join(root, 'dir', 'a.txt'), 'utf8')).toBe('hello world');
    // Through a link to the same directory.
    await symlink('dir', join(root, 'alias'));
    expect(
      (await runFileRequest(root, { op: 'move', target, path: '/dir/a.txt', to: '/alias/a.txt', overwrite: true })).ok,
    ).toBe(true);
    expect(
      (await runFileRequest(root, { op: 'copy', target, path: '/dir/a.txt', to: '/alias/a.txt', overwrite: true }))
        .error?.code,
    ).toBe('denied');
    expect(await readFile(join(root, 'dir', 'a.txt'), 'utf8')).toBe('hello world');
    // Overwriting a directory that contains the source.
    expect(
      (await runFileRequest(root, { op: 'move', target, path: '/dir/a.txt', to: '/dir', overwrite: true })).error?.code,
    ).toBe('denied');
    expect(await readFile(join(root, 'dir', 'a.txt'), 'utf8')).toBe('hello world');
    // A file is replaced in place; a directory in the way only when overwriting.
    await writeFile(join(root, 'b.txt'), 'b');
    expect(
      (await runFileRequest(root, { op: 'copy', target, path: '/b.txt', to: '/dir/a.txt', overwrite: true })).ok,
    ).toBe(true);
    expect(await readFile(join(root, 'dir', 'a.txt'), 'utf8')).toBe('b');
    await mkdir(join(root, 'box', 'inner'), { recursive: true });
    expect(
      (await runFileRequest(root, { op: 'move', target, path: '/b.txt', to: '/box', overwrite: false })).error?.code,
    ).toBe('exists');
    expect((await runFileRequest(root, { op: 'move', target, path: '/b.txt', to: '/box', overwrite: true })).ok).toBe(
      true,
    );
    expect(await readFile(join(root, 'box'), 'utf8')).toBe('b');
  });
});
