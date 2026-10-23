import { randomBytes } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  opendir,
  readdir,
  readlink,
  rename,
  rmdir,
  symlink,
  unlink,
  type FileHandle,
} from 'node:fs/promises';

import type { FileEntry, FileRequest, FileResponse } from '@forepath/loadweaver/shared/util-agent-protocol';

export class ConfinedFsError extends Error {
  constructor(
    readonly code: 'not-found' | 'exists' | 'denied' | 'too-large' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

const MAX_ENTRIES = 10_000;
/** Symbolic links followed while resolving one path (the kernel's own limit). */
const MAX_LINK_HOPS = 40;
/** Depth of a recursive copy or delete (every level holds open directory descriptors). */
const MAX_DEPTH = 256;
const COPY_CHUNK = 1024 * 1024;
/** `O_PATH` (Linux): a descriptor naming an inode without opening it, so a device or FIFO is never opened. */
const O_PATH = 0o10000000;
const DIR_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

/**
 * `openat(2)` emulation: `name` inside an open directory. The kernel resolves `/proc/self/fd/<fd>` to the directory
 * itself (not to a path string), so nothing a container swaps in above `name` redirects the operation.
 */
const at = (dir: FileHandle, name: string) => `/proc/self/fd/${dir.fd}/${name}`;
const self = (handle: FileHandle) => `/proc/self/fd/${handle.fd}`;

/** The request path's components, `.` and `..` resolved lexically (a `..` above the root is refused). */
function components(path: string): string[] {
  const parts: string[] = [];

  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;

    if (part !== '..') parts.push(part);
    else if (!parts.pop()) throw new ConfinedFsError('denied', 'path outside the root');
  }

  return parts;
}

/** An entry inside the root: `name` in the last directory of `chain` (`.` for that directory itself). */
interface Location {
  /** The open directories from the root to the entry's parent (the root's descriptor is borrowed). */
  chain: FileHandle[];
  name: string;
}

const parent = (location: Location) => location.chain[location.chain.length - 1];

async function release(location: Location): Promise<void> {
  for (const handle of location.chain.slice(1)) await handle.close().catch(() => undefined);
}

/**
 * A path inside the root (3.19 file browser), walked one component at a time with directory descriptors opened
 * `O_NOFOLLOW`. Symbolic links are resolved here, never by the kernel: absolute targets start over at the root (as
 * the container sees them), a `..` above the root is refused. The final component is followed only when `follow`
 * (reads, listings); writes, deletes and moves act on the final component itself (a link is replaced, never
 * followed). A final component that doesn't exist (yet) is returned as is: the caller decides.
 */
async function locate(root: FileHandle, path: string, follow: boolean): Promise<Location> {
  const location: Location = { chain: [root], name: '.' };
  const pending = components(path);
  let hops = 0;

  try {
    for (let name = pending.shift(); name !== undefined; name = pending.shift()) {
      if (name === '' || name === '.') continue;

      if (name === '..') {
        // Only link targets get here (the request path is resolved lexically).
        if (location.chain.length === 1) throw new ConfinedFsError('denied', 'link leads outside the root');

        await location.chain.pop()?.close();
        continue;
      }

      const last = pending.length === 0;

      if (last && !follow) return { ...location, name };

      const stats = await lstat(at(parent(location), name)).catch((error: NodeJS.ErrnoException) => {
        if (last && error.code === 'ENOENT') return null;

        throw error;
      });

      if (stats?.isSymbolicLink()) {
        if (++hops > MAX_LINK_HOPS) throw new ConfinedFsError('denied', 'too many symbolic links');

        const target = await readlink(at(parent(location), name));

        if (target.startsWith('/')) for (const handle of location.chain.splice(1)) await handle.close();

        pending.unshift(...target.split('/'));
        continue;
      }

      if (last) return { ...location, name };

      // O_NOFOLLOW: a directory swapped for a link since the lstat fails here (ELOOP) instead of leaving the root.
      location.chain.push(await open(at(parent(location), name), DIR_FLAGS));
    }

    return location;
  } catch (error) {
    await release(location);
    throw error;
  }
}

async function within<T>(
  root: FileHandle,
  path: string,
  follow: boolean,
  run: (location: Location) => Promise<T>,
): Promise<T> {
  const location = await locate(root, path, follow);

  try {
    return await run(location);
  } finally {
    await release(location);
  }
}

/**
 * Opens a regular file: first as a bare reference (`O_PATH | O_NOFOLLOW`, nothing is opened), checked, then reopened
 * through that reference. A FIFO, socket, device or link in its place is refused without ever being opened.
 */
async function openRegular(dir: FileHandle, name: string, flags: number): Promise<FileHandle> {
  const reference = await open(at(dir, name), O_PATH | constants.O_NOFOLLOW);

  try {
    const stats = await reference.stat();

    if (stats.isSymbolicLink()) throw new ConfinedFsError('denied', 'symbolic link');

    if (!stats.isFile()) throw new ConfinedFsError('denied', 'not a regular file');

    return await open(self(reference), flags | constants.O_NONBLOCK);
  } finally {
    await reference.close();
  }
}

async function entry(dir: FileHandle, name: string, displayName = name): Promise<FileEntry> {
  const s = await lstat(at(dir, name));

  return {
    name: displayName,
    type: s.isFile() ? 'file' : s.isDirectory() ? 'directory' : s.isSymbolicLink() ? 'symlink' : 'other',
    size: s.isFile() ? s.size : 0,
    modifiedAt: s.mtime.toISOString(),
    mode: s.mode & 0o7777,
  };
}

const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;

/** Whether the directory `stats` is one of the open directories of `chain` (i.e. contains the location). */
async function among(stats: BigIntStats, chain: FileHandle[]): Promise<boolean> {
  for (const handle of chain) if (same(stats, await handle.stat({ bigint: true }))) return true;

  return false;
}

/** Removes an entry and, for a directory, everything below it: walked by descriptors, links are never followed. */
async function remove(dir: FileHandle, name: string, depth = 0): Promise<void> {
  if (!(await lstat(at(dir, name))).isDirectory()) return void (await unlink(at(dir, name)));

  if (depth >= MAX_DEPTH) throw new ConfinedFsError('too-large', 'directory tree too deep');

  const sub = await open(at(dir, name), DIR_FLAGS);

  try {
    for (const child of await readdir(self(sub))) await remove(sub, child, depth + 1);
  } finally {
    await sub.close();
  }

  await rmdir(at(dir, name));
}

async function copyFile(from: FileHandle, to: FileHandle): Promise<void> {
  const buffer = Buffer.alloc(COPY_CHUNK);

  for (let position = 0; ; ) {
    const { bytesRead } = await from.read(buffer, 0, buffer.length, position);

    if (bytesRead === 0) return;

    for (let written = 0; written < bytesRead; ) {
      written += (await to.write(buffer, written, bytesRead - written, position + written)).bytesWritten;
    }

    position += bytesRead;
  }
}

/**
 * Copies an entry (a directory recursively), walked by descriptors: links are copied verbatim, FIFOs, sockets and
 * devices are skipped (never opened). Set-id bits are dropped (the copies belong to root).
 */
async function copy(
  fromDir: FileHandle,
  fromName: string,
  toDir: FileHandle,
  toName: string,
  depth = 0,
): Promise<void> {
  const stats = await lstat(at(fromDir, fromName));

  if (stats.isSymbolicLink()) {
    await symlink(await readlink(at(fromDir, fromName)), at(toDir, toName));

    return;
  }

  if (stats.isDirectory()) {
    if (depth >= MAX_DEPTH) throw new ConfinedFsError('too-large', 'directory tree too deep');

    const from = await open(at(fromDir, fromName), DIR_FLAGS);

    try {
      await mkdir(at(toDir, toName), { mode: stats.mode & 0o777 });

      const to = await open(at(toDir, toName), DIR_FLAGS);

      try {
        for (const child of await readdir(self(from))) await copy(from, child, to, child, depth + 1);
      } finally {
        await to.close();
      }
    } finally {
      await from.close();
    }

    return;
  }

  if (!stats.isFile()) return;

  const from = await openRegular(fromDir, fromName, constants.O_RDONLY);

  try {
    const to = await open(
      at(toDir, toName),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      stats.mode & 0o777,
    );

    try {
      await copyFile(from, to);
    } finally {
      await to.close();
    }
  } finally {
    await from.close();
  }
}

/**
 * Renames an entry into place. rename(2) replaces a file atomically; a directory in the way (or a file where a
 * directory goes) is removed first, and only when overwriting.
 */
async function place(from: Location, to: Location, overwrite: boolean): Promise<void> {
  const attempt = () => rename(at(parent(from), from.name), at(parent(to), to.name));

  try {
    await attempt();
  } catch (error) {
    if (
      !overwrite ||
      !['EISDIR', 'ENOTDIR', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')
    )
      throw error;

    await remove(parent(to), to.name);
    await attempt();
  }
}

async function moveOrCopy(root: FileHandle, request: Extract<FileRequest, { op: 'move' | 'copy' }>): Promise<void> {
  await within(root, request.path, false, (from) =>
    within(root, request.to, false, async (to) => {
      if (from.name === '.' || to.name === '.') throw new ConfinedFsError('denied', 'the root itself');

      const source = await lstat(at(parent(from), from.name), { bigint: true });

      // Onto itself (after normalisation and links above it): a move changes nothing, a copy is refused.
      if (
        from.name === to.name &&
        same(await parent(from).stat({ bigint: true }), await parent(to).stat({ bigint: true }))
      ) {
        if (request.op === 'move') return;

        throw new ConfinedFsError('denied', 'onto itself');
      }

      if (source.isDirectory() && (await among(source, to.chain))) throw new ConfinedFsError('denied', 'into itself');

      const target = await lstat(at(parent(to), to.name), { bigint: true }).catch(() => null);

      if (target) {
        if (!request.overwrite) throw new ConfinedFsError('exists', 'the destination exists');

        // Replacing a directory that contains the source would delete the source.
        if (target.isDirectory() && (await among(target, from.chain)))
          throw new ConfinedFsError('denied', 'onto a directory containing the source');
      }

      if (request.op === 'move') return await place(from, to, request.overwrite);

      // A copy is made next to the destination first, then renamed into place.
      const temporary: Location = { chain: to.chain, name: `.lw-copy-${randomBytes(8).toString('hex')}` };

      try {
        await copy(parent(from), from.name, parent(to), temporary.name);
        await place(temporary, to, request.overwrite);
      } catch (error) {
        await remove(parent(to), temporary.name).catch(() => undefined);
        throw error;
      }
    }),
  );
}

async function run(root: FileHandle, request: FileRequest): Promise<FileResponse> {
  switch (request.op) {
    case 'list':
      return await within(root, request.path, true, async (location) => {
        const dir = await open(at(parent(location), location.name), DIR_FLAGS);

        try {
          const names: string[] = [];

          for await (const e of await opendir(self(dir))) {
            if (names.push(e.name) > MAX_ENTRIES)
              throw new ConfinedFsError('too-large', `more than ${MAX_ENTRIES} entries`);
          }

          const entries = (await Promise.all(names.map((n) => entry(dir, n).catch(() => null)))).filter(
            (e): e is FileEntry => !!e,
          );

          return {
            ok: true,
            entries: entries.sort((a, b) =>
              (a.type === 'directory') === (b.type === 'directory')
                ? a.name.localeCompare(b.name)
                : a.type === 'directory'
                  ? -1
                  : 1,
            ),
          };
        } finally {
          await dir.close();
        }
      });
    case 'stat':
      return await within(root, request.path, true, async (location) => ({
        ok: true,
        entry: await entry(
          parent(location),
          location.name,
          location.name === '.' ? (components(request.path).at(-1) ?? '/') : location.name,
        ),
      }));
    case 'read':
      return await within(root, request.path, true, async (location) => {
        const handle = await openRegular(parent(location), location.name, constants.O_RDONLY);

        try {
          const buffer = Buffer.alloc(request.length);
          const { bytesRead } = await handle.read(buffer, 0, request.length, request.offset);

          return { ok: true, data: buffer.subarray(0, bytesRead).toString('base64') };
        } finally {
          await handle.close();
        }
      });
    case 'write':
      return await within(root, request.path, false, async (location) => {
        const handle = await openRegular(
          parent(location),
          location.name,
          constants.O_WRONLY | (request.truncate ? constants.O_TRUNC : 0),
        ).catch(async (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;

          // O_EXCL: never follows a link created in the meantime.
          return await open(
            at(parent(location), location.name),
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            0o644,
          );
        });

        try {
          await handle.write(Buffer.from(request.data, 'base64'), 0, undefined, request.offset);
        } finally {
          await handle.close();
        }

        return { ok: true };
      });
    case 'mkdir':
      return await within(root, request.path, false, async (location) => {
        if (location.name === '.') throw new ConfinedFsError('exists', 'already exists');

        await mkdir(at(parent(location), location.name), { mode: 0o755 });

        return { ok: true };
      });
    case 'delete':
      return await within(root, request.path, false, async (location) => {
        if (location.name === '.') throw new ConfinedFsError('denied', 'the root itself');

        await remove(parent(location), location.name);

        return { ok: true };
      });
    case 'move':
    case 'copy':
      await moveOrCopy(root, request);

      return { ok: true };
  }
}

const ERRNO: Record<string, ConfinedFsError> = {
  ENOENT: new ConfinedFsError('not-found', 'no such file or directory'),
  ENOTDIR: new ConfinedFsError('not-found', 'not a directory'),
  ELOOP: new ConfinedFsError('denied', 'symbolic link'),
  EEXIST: new ConfinedFsError('exists', 'already exists'),
  ENOTEMPTY: new ConfinedFsError('exists', 'the destination exists'),
  ENXIO: new ConfinedFsError('denied', 'not a regular file'),
};

/** Runs one file request inside `root` (a directory the agent chose: a container's merged filesystem or a volume). */
export async function runFileRequest(root: string, request: FileRequest): Promise<FileResponse> {
  try {
    const handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY);

    try {
      return await run(handle, request);
    } finally {
      await handle.close();
    }
  } catch (caught) {
    const error = caught instanceof ConfinedFsError ? caught : ERRNO[(caught as NodeJS.ErrnoException).code ?? ''];

    if (error) return { ok: false, error: { code: error.code, message: error.message } };

    return {
      ok: false,
      error: { code: 'failed', message: (caught instanceof Error ? caught.message : String(caught)).slice(0, 1024) },
    };
  }
}
