import { createReadStream, createWriteStream, constants, type BigIntStats } from 'node:fs';
import {
  chmod,
  link,
  lchown,
  lstat,
  lutimes,
  mkdir,
  open,
  readdir,
  readlink,
  rm,
  symlink,
  utimes,
  type FileHandle,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { Writable } from 'node:stream';

import { CommandRunner } from '../host/command-runner';
import { writeChunk } from '../migration/transfer-protocol';
import { keptXattr, normalizeEntryPath, OVERLAY_OPAQUE_XATTR, readTar } from './rootfs-unpack';

/**
 * File-level pre-copy of a generic microVM's guest trees for QEMU live migration (M7 W10b): the per-replica writable
 * layer (overlay upper) and tmpfs volumes. Iterative passes while the guest runs (each sends what changed since the
 * previous one: lstat signature incl. ctime / inode), a last pass while the guest is stopped (QEMU
 * pause-before-switchover). On the target a pass is applied through the overlay's merged directory (never into a
 * mounted overlay's upper): whiteouts become deletions, opaque directories lose the lower entries the source hides,
 * everything else is written with owner, mode, mtime and the kept xattrs (`user.*`, `security.capability`).
 *
 * Both trees are guest-controlled. The source never follows a symlink: directories are opened one component at a time
 * (`O_NOFOLLOW`, through `/proc/self/fd/<dir>/<name>`), files `O_NOFOLLOW` and checked against the scanned inode. The
 * target refuses entries below anything that isn't a real directory and replaces (never follows) existing links.
 * Device nodes and sockets are skipped (counted), names that aren't UTF-8 fail the pass.
 */

/** `overlay`: an overlay upper (whiteouts, opaque directories); `plain`: an ordinary tree (tmpfs). */
export type SyncMode = 'overlay' | 'plain';
/** Path → lstat signature of the last pass (what the target has). */
export type GuestManifest = Map<string, string>;

export interface PassMeta {
  v: 1;
  /** Paths to delete on the target first (deleted since the last pass, or overlay whiteouts). */
  remove: string[];
  /** Overlay directories that became opaque: their entries in the source upper (everything else goes). */
  opaque: Record<string, string[]>;
  /** Device nodes / sockets not transferred. */
  skipped: number;
}

export interface PassResult {
  manifest: GuestManifest;
  meta: PassMeta;
  /** File bytes in the pass. */
  bytes: number;
  /** Entries in the pass (incl. deletions). */
  entries: number;
}

/** Host operations Node's `fs` lacks (xattrs, FIFOs), through `attr` / coreutils; never through a shell. */
export interface GuestSyncOps {
  /** Kept xattrs (+ the overlay's opaque flag) of `paths`, without following symlinks; absent paths are left out. */
  xattrs(paths: string[]): Promise<Map<string, Record<string, Buffer>>>;
  setXattr(path: string, name: string, value: Buffer): Promise<void>;
  mkfifo(path: string, mode: number): Promise<void>;
}

export const MAX_SYNC_ENTRIES = 500_000;
const MAX_DEPTH = 256;
const XATTR_BATCH = 256;
const BLOCK = 512;
const COPY_CHUNK = 1024 * 1024;
const DIR_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const XATTR_PATTERN = '^(user\\..*|security\\.capability|trusted\\.overlay\\.opaque)$';

/**
 * `openat(2)` emulation through the agent's own descriptor table: the kernel resolves `/proc/<pid>/fd/<n>` to the
 * open directory itself, so nothing swapped in above `name` redirects the operation. The pid (not `self`) keeps the
 * path valid for the `getfattr` / `setfattr` children as well.
 */
export const fdPath = (handle: FileHandle) => `/proc/${process.pid}/fd/${handle.fd}`;
const at = (dir: FileHandle, name: string) => `${fdPath(dir)}/${name}`;
const self = fdPath;

/** getfattr's `# file:` names: bytes outside printable ASCII and `\` come octal-escaped. */
export function unescapeGetfattr(name: string): string {
  const bytes: number[] = [];

  for (let i = 0; i < name.length; i++) {
    const match = name[i] === '\\' ? /^[0-7]{3}/.exec(name.slice(i + 1)) : null;

    if (match) {
      bytes.push(parseInt(match[0], 8));
      i += 3;
    } else bytes.push(...Buffer.from(name[i], 'utf8'));
  }

  return Buffer.from(bytes).toString('utf8');
}

/** Parses `getfattr -d -e base64 --absolute-names` output. */
export function parseGetfattr(stdout: string): Map<string, Record<string, Buffer>> {
  const result = new Map<string, Record<string, Buffer>>();
  let current: Record<string, Buffer> | null = null;

  for (const line of stdout.split('\n')) {
    if (line.startsWith('# file: ')) {
      current = {};
      result.set(unescapeGetfattr(line.slice('# file: '.length)), current);
    } else if (current && line.includes('=')) {
      const index = line.indexOf('=');
      const value = line.slice(index + 1);

      current[line.slice(0, index)] = value.startsWith('0s')
        ? Buffer.from(value.slice(2), 'base64')
        : Buffer.from(value.replace(/^"|"$/g, ''), 'utf8');
    }
  }

  return result;
}

export function commandSyncOps(commands: CommandRunner): GuestSyncOps {
  return {
    xattrs: async (paths) => {
      const result = new Map<string, Record<string, Buffer>>();

      for (let i = 0; i < paths.length; i += XATTR_BATCH) {
        const { stdout } = await commands.run(
          'getfattr',
          [
            '-h',
            '-d',
            '-m',
            XATTR_PATTERN,
            '-e',
            'base64',
            '--absolute-names',
            '--',
            ...paths.slice(i, i + XATTR_BATCH),
          ],
          // 1: some path vanished meanwhile (guest running); the rest is printed.
          { okExitCodes: [1], timeoutMs: 120_000 },
        );

        for (const [path, attrs] of parseGetfattr(stdout)) result.set(path, attrs);
      }

      return result;
    },
    setXattr: async (path, name, value) => {
      await commands.run('setfattr', ['-h', '-n', name, '-v', `0s${value.toString('base64')}`, '--', path]);
    },
    mkfifo: async (path, mode) => {
      await commands.run('mknod', ['-m', (mode & 0o7777).toString(8), '--', path, 'p']);
    },
  };
}

// --- tar writer (pax: path, link, size, owner, mtime and xattrs always in an extended header) --------------------

function octal(value: number, length: number): string {
  const text = value.toString(8);

  return text.length < length ? text.padStart(length - 1, '0') : '0'.repeat(length - 1);
}

function paxRecord(key: string, value: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(` ${key}=`, 'utf8'), value, Buffer.from('\n')]);
  let length = body.length + 1;

  while (String(length).length + body.length !== length) length = String(length).length + body.length;

  return Buffer.concat([Buffer.from(String(length)), body]);
}

function header(name: string, flag: string, mode: number, size: number): Buffer {
  const block = Buffer.alloc(BLOCK);

  block.write(name.slice(0, 99).replace(/[^\x20-\x7e]/g, '_'), 0, 'ascii');
  block.write(octal(mode & 0o7777, 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  block.write(octal(0, 12), 136, 'ascii');
  block.write(flag, 156, 'ascii');
  block.write('ustar\u000000', 257, 'ascii');
  block.fill(0x20, 148, 156);

  let sum = 0;

  for (const byte of block) sum += byte;

  block.write(`${sum.toString(8).padStart(6, '0')}\u0000 `, 148, 'ascii');

  return block;
}

interface TarMeta {
  path: string;
  flag: '0' | '1' | '2' | '5' | '6';
  stat: Pick<BigIntStats, 'mode' | 'uid' | 'gid' | 'mtimeNs'>;
  size?: number;
  linkname?: string;
  xattrs?: Record<string, Buffer>;
}

export class TarWriter {
  bytes = 0;
  entries = 0;

  constructor(private readonly out: Writable) {}

  private async write(chunk: Buffer): Promise<void> {
    await writeChunk(this.out, chunk);
  }

  async entry(meta: TarMeta, body?: FileHandle): Promise<void> {
    const size = meta.size ?? 0;
    const seconds = meta.stat.mtimeNs / 1_000_000_000n;
    const records = [
      paxRecord('path', Buffer.from(meta.path, 'utf8')),
      paxRecord('uid', Buffer.from(String(meta.stat.uid))),
      paxRecord('gid', Buffer.from(String(meta.stat.gid))),
      paxRecord('size', Buffer.from(String(size))),
      paxRecord('mtime', Buffer.from(seconds.toString())),
      ...(meta.linkname !== undefined ? [paxRecord('linkpath', Buffer.from(meta.linkname, 'utf8'))] : []),
      ...Object.entries(meta.xattrs ?? {}).map(([name, value]) => paxRecord(`SCHILY.xattr.${name}`, value)),
    ];
    const pax = Buffer.concat(records);

    await this.write(header('PaxHeader', 'x', 0o644, pax.length));
    await this.write(pax);
    await this.write(Buffer.alloc((BLOCK - (pax.length % BLOCK)) % BLOCK));
    await this.write(header(meta.path, meta.flag, Number(meta.stat.mode), size));

    if (body && size > 0) {
      let left = size;
      let position = 0;

      while (left > 0) {
        const buffer = Buffer.alloc(Math.min(COPY_CHUNK, left));
        const { bytesRead } = await body.read(buffer, 0, buffer.length, position);

        // A file that shrank while the guest ran: zeros now, the next pass sends it again (its mtime changed).
        if (bytesRead === 0) {
          await this.write(Buffer.alloc(left));
          break;
        }

        await this.write(buffer.subarray(0, bytesRead));
        left -= bytesRead;
        position += bytesRead;
      }

      await this.write(Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK));
      this.bytes += size;
    }

    this.entries++;
  }

  async end(): Promise<void> {
    await this.write(Buffer.alloc(BLOCK * 2));
    await new Promise<void>((resolve, reject) => {
      this.out.once('error', reject);
      this.out.end(() => resolve());
    });
  }
}

// --- source: one pass ------------------------------------------------------------------------------------------

type Kind = 'file' | 'dir' | 'symlink' | 'fifo' | 'whiteout' | 'other';

function kindOf(stat: BigIntStats, mode: SyncMode): Kind {
  if (stat.isFile()) return 'file';

  if (stat.isDirectory()) return 'dir';

  if (stat.isSymbolicLink()) return 'symlink';

  if (stat.isFIFO()) return 'fifo';

  if (mode === 'overlay' && stat.isCharacterDevice() && stat.rdev === 0n) return 'whiteout';

  return 'other';
}

function signature(kind: Kind, stat: BigIntStats): string {
  return [kind, stat.mode, stat.uid, stat.gid, stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino].join(':');
}

/** Opens `relative` below `base` one component at a time, refusing symlinks (guest-controlled trees). */
export async function openTree(base: string, relative = ''): Promise<FileHandle> {
  let handle = await open(base, constants.O_RDONLY | constants.O_DIRECTORY);

  for (const part of relative.split('/').filter((p) => p !== '' && p !== '.')) {
    if (part === '..') {
      await handle.close();
      throw new Error(`refusing '..' in ${relative}`);
    }

    const next = await open(at(handle, part), DIR_FLAGS).finally(() => handle.close());

    handle = next;
  }

  return handle;
}

/**
 * Paths (relative to a tree's root) that are mount points in the launcher — volumes, tmpfs, secrets of a bundled
 * image's `/guest` (M7 F5): never scanned, written, deleted or deleted through. `isExcluded`: the path or below it;
 * `holdsExcluded`: a mount point lies below the path.
 */
export function excludedPaths(paths: readonly string[] = []): {
  isExcluded: (relative: string) => boolean;
  holdsExcluded: (relative: string) => boolean;
} {
  const list = paths.map((p) => normalizeEntryPath(p.replace(/^\/+/, ''))).filter((p): p is string => !!p);

  return {
    isExcluded: (relative) => list.some((p) => relative === p || relative.startsWith(`${p}/`)),
    holdsExcluded: (relative) => list.some((p) => p.startsWith(`${relative}/`)),
  };
}

export interface PassOptions {
  /** The tree's root (opened through {@link openTree}). */
  root: FileHandle;
  mode: SyncMode;
  /** Mount points of the launcher below the tree (relative paths): left out ({@link excludedPaths}). */
  exclude?: readonly string[];
  previous: GuestManifest;
  /** Where the pass's tar goes. */
  out: Writable;
  ops: GuestSyncOps;
}

/** Scans the tree and writes what changed since `previous` as a tar to `out`. */
export async function scanPass(options: PassOptions): Promise<PassResult> {
  const { mode, previous, ops } = options;
  const manifest: GuestManifest = new Map();
  const meta: PassMeta = { v: 1, remove: [], opaque: {}, skipped: 0 };
  const tar = new TarWriter(options.out);
  const inodes = new Map<bigint, string>();
  const { isExcluded } = excludedPaths(options.exclude);

  const visit = async (dir: FileHandle, relative: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) throw new Error(`guest tree deeper than ${MAX_DEPTH} levels at ${relative}`);

    const names = (await readdir(self(dir))).sort();
    const changed: { name: string; path: string; kind: Kind; stat: BigIntStats }[] = [];
    const subdirs: { name: string; path: string }[] = [];

    for (const name of names) {
      if (name.includes('�')) throw new Error(`file name that isn't UTF-8 below /${relative}`);

      const stat = await lstat(at(dir, name), { bigint: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;

        throw error;
      });

      if (!stat) continue;

      const path = relative ? `${relative}/${name}` : name;

      if (isExcluded(path)) continue;

      const kind = kindOf(stat, mode);
      const sig = signature(kind, stat);

      manifest.set(path, sig);

      if (manifest.size > MAX_SYNC_ENTRIES)
        throw new Error(`more than ${MAX_SYNC_ENTRIES} entries to pre-copy (writable layer too large)`);

      if (previous.get(path) !== sig) changed.push({ name, path, kind, stat });

      if (kind === 'dir') subdirs.push({ name, path });
    }

    const withXattrs = changed.filter((c) => c.kind === 'file' || c.kind === 'dir' || c.kind === 'fifo');
    const xattrs = withXattrs.length
      ? await ops.xattrs(withXattrs.map((c) => at(dir, c.name)))
      : new Map<string, Record<string, Buffer>>();

    for (const entry of changed) {
      const attrs = xattrs.get(at(dir, entry.name)) ?? {};
      const kept = Object.fromEntries(Object.entries(attrs).filter(([name]) => keptXattr(name)));

      switch (entry.kind) {
        case 'whiteout':
          meta.remove.push(entry.path);
          break;
        case 'other':
          meta.skipped++;
          break;
        case 'dir':
          await tar.entry({ path: entry.path, flag: '5', stat: entry.stat, xattrs: kept });

          if (mode === 'overlay' && attrs[OVERLAY_OPAQUE_XATTR]?.toString() === 'y')
            meta.opaque[entry.path] = await readdir(at(dir, entry.name)).catch(() => []);
          break;
        case 'symlink':
          await tar.entry({
            path: entry.path,
            flag: '2',
            stat: entry.stat,
            linkname: await readlink(at(dir, entry.name)),
          });
          break;
        case 'fifo':
          await tar.entry({ path: entry.path, flag: '6', stat: entry.stat, xattrs: kept });
          break;
        case 'file': {
          const first = entry.stat.nlink > 1n ? inodes.get(entry.stat.ino) : undefined;

          if (first) {
            await tar.entry({ path: entry.path, flag: '1', stat: entry.stat, linkname: first });
            break;
          }

          const handle = await open(at(dir, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);

          try {
            const opened = await handle?.stat({ bigint: true });

            // Replaced since the scan (the guest runs): the next pass sends it.
            if (!handle || !opened?.isFile() || opened.ino !== entry.stat.ino) {
              manifest.set(entry.path, 'changed');
              break;
            }

            if (entry.stat.nlink > 1n) inodes.set(entry.stat.ino, entry.path);

            await tar.entry(
              { path: entry.path, flag: '0', stat: entry.stat, size: Number(entry.stat.size), xattrs: kept },
              handle,
            );
          } finally {
            await handle?.close();
          }

          break;
        }
      }
    }

    for (const sub of subdirs) {
      const handle = await open(at(dir, sub.name), DIR_FLAGS).catch(() => null);

      // Swapped for a link or gone (the guest runs): sent again by the next pass.
      if (!handle) {
        manifest.set(sub.path, 'changed');
        continue;
      }

      try {
        await visit(handle, sub.path, depth + 1);
      } finally {
        await handle.close();
      }
    }
  };

  await visit(options.root, '', 0);

  // Deleted since the last pass: only the topmost path of a deleted subtree.
  const removed = [...previous.keys()].filter((p) => !manifest.has(p)).sort();
  let last: string | null = null;

  for (const path of removed) {
    if (last !== null && path.startsWith(`${last}/`)) continue;

    meta.remove.push(path);
    last = path;
  }

  await tar.end();

  return { manifest, meta, bytes: tar.bytes, entries: tar.entries + meta.remove.length };
}

// --- target: apply a pass ----------------------------------------------------------------------------------------

/** Validates a received pass description (it came from a peer node). */
export function parsePassMeta(value: unknown): PassMeta {
  const meta = value as Partial<PassMeta> | null;
  const paths = (list: unknown) =>
    Array.isArray(list) &&
    list.length <= MAX_SYNC_ENTRIES &&
    list.every((p) => typeof p === 'string' && normalizeEntryPath(p) !== null);

  if (
    !meta ||
    meta.v !== 1 ||
    !paths(meta.remove) ||
    typeof meta.opaque !== 'object' ||
    meta.opaque === null ||
    !Object.entries(meta.opaque).every(
      ([dir, names]) =>
        normalizeEntryPath(dir) !== null &&
        Array.isArray(names) &&
        names.every((n) => typeof n === 'string' && n !== '' && !n.includes('/')),
    )
  )
    throw new Error('invalid guest sync pass');

  return { v: 1, remove: meta.remove as string[], opaque: meta.opaque, skipped: Number(meta.skipped) || 0 };
}

/** Every existing ancestor of `relative` below `root` must be a real directory (no link is ever followed). */
async function assertParents(root: string, relative: string): Promise<void> {
  const parts = relative.split('/');

  for (let i = 1; i < parts.length; i++) {
    const info = await lstat(join(root, ...parts.slice(0, i))).catch(() => null);

    if (!info) throw new Error(`parent of ${relative} missing on the target`);

    if (!info.isDirectory()) throw new Error(`refusing to write below a non-directory: ${parts.slice(0, i).join('/')}`);
  }
}

export interface ApplyOptions {
  /** The target tree (overlay: the merged directory), e.g. {@link fdPath} of a handle from {@link openTree}. */
  root: string;
  tar: AsyncIterable<Buffer>;
  meta: PassMeta;
  ops: GuestSyncOps;
  /**
   * The target launcher's mount points below the tree (relative paths): nothing is written at or below them, and
   * nothing that holds one is deleted or replaced ({@link excludedPaths}).
   */
  exclude?: readonly string[];
}

/**
 * Applies one pass on the target: deletions, opaque directories, then the entries. The target guest doesn't run
 * yet (nothing else writes the tree meanwhile), so checking parents before each operation is race-free.
 */
export async function applyPass(options: ApplyOptions): Promise<{ entries: number; bytes: number; skipped: number }> {
  const { root, meta, ops } = options;
  let entries = 0;
  let bytes = 0;
  let skipped = 0;
  const { isExcluded, holdsExcluded } = excludedPaths(options.exclude);
  const untouchable = (relative: string) => isExcluded(relative) || holdsExcluded(relative);

  for (const path of meta.remove) {
    const relative = normalizeEntryPath(path) as string;

    if (untouchable(relative)) {
      skipped++;
      continue;
    }

    // Below a missing parent there is nothing to delete; below a link nothing of the tree's.
    if (
      await assertParents(root, relative).then(
        () => true,
        () => false,
      )
    )
      await rm(join(root, relative), { recursive: true, force: true });

    entries++;
  }

  for (const [dir, keep] of Object.entries(meta.opaque)) {
    const relative = normalizeEntryPath(dir) as string;

    if (isExcluded(relative)) continue;

    const target = join(root, relative);
    const info = await lstat(target).catch(() => null);

    if (!info?.isDirectory()) continue;

    await assertParents(root, relative);

    const kept = new Set(keep);

    for (const name of await readdir(target))
      if (!kept.has(name) && !untouchable(`${relative}/${name}`))
        await rm(join(target, name), { recursive: true, force: true });
  }

  const directories: { path: string; mtime: number }[] = [];

  for await (const { entry, body } of readTar(options.tar)) {
    const relative = normalizeEntryPath(entry.name);

    if (!relative) continue;

    // A mount point (or below one): the target launcher's own; a directory entry holding one only if it stays one.
    if (isExcluded(relative) || (holdsExcluded(relative) && entry.type !== 'dir')) {
      skipped++;
      continue;
    }

    const target = join(root, relative);
    const existing = await lstat(target).catch(() => null);
    const xattrs = Object.entries(entry.xattrs).filter(([name]) => keptXattr(name));

    await assertParents(root, relative);

    if (existing && !(entry.type === 'dir' && existing.isDirectory()))
      await rm(target, { recursive: true, force: true });

    switch (entry.type) {
      case 'dir':
        if (!existing?.isDirectory()) await mkdir(target, { mode: 0o700 });

        await lchown(target, entry.uid, entry.gid);
        await chmod(target, entry.mode);
        directories.push({ path: target, mtime: entry.mtime });
        break;
      case 'file': {
        const handle = await open(
          target,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );

        try {
          let position = 0;

          for await (const chunk of body()) {
            await handle.write(chunk, 0, chunk.length, position);
            position += chunk.length;
          }

          bytes += position;
          await handle.chown(entry.uid, entry.gid);
          await handle.chmod(entry.mode);
        } finally {
          await handle.close();
        }

        await utimes(target, entry.mtime, entry.mtime);
        break;
      }

      case 'symlink':
        await symlink(entry.linkname, target);
        await lchown(target, entry.uid, entry.gid);
        await lutimes(target, entry.mtime, entry.mtime).catch(() => undefined);
        break;
      case 'hardlink': {
        const source = normalizeEntryPath(entry.linkname);

        if (!source) throw new Error(`invalid hard link ${entry.linkname}`);

        await assertParents(root, source);

        if (!(await lstat(join(root, source))).isFile()) throw new Error(`hard link to a non-file ${source}`);

        await link(join(root, source), target);
        break;
      }

      case 'fifo':
        await ops.mkfifo(target, entry.mode);
        await lchown(target, entry.uid, entry.gid);
        break;
      default:
        skipped++;
        continue;
    }

    // After chown (which drops file capabilities).
    if (entry.type !== 'symlink' && entry.type !== 'hardlink')
      for (const [name, value] of xattrs) await ops.setXattr(target, name, value);

    entries++;
  }

  // Directory times last: adding their entries changed them.
  for (const dir of directories.reverse()) await utimes(dir.path, dir.mtime, dir.mtime).catch(() => undefined);

  return { entries, bytes, skipped };
}

/** A pass's tar as written by {@link scanPass}, read back for {@link applyPass}. */
export function readPassTar(file: string): AsyncIterable<Buffer> {
  return createReadStream(file, { highWaterMark: COPY_CHUNK }) as AsyncIterable<Buffer>;
}

/** A writable for {@link scanPass} (0600). */
export function passTarFile(file: string): Writable {
  return createWriteStream(file, { mode: 0o600 });
}
