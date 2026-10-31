import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';

import { classifyAptPath, indexFiles, releaseChecksums, sha256Hex, type AptUpstream } from './apt-snapshot.utils';

/**
 * The frozen-index apt source without framework dependencies (used by the control plane's service and the VM lab).
 * See `apt-snapshot.utils.ts` for the trust model: apt on the node verifies signatures and checksums itself.
 */

export interface BlobStore {
  has(sha256: string): Promise<boolean>;
  put(sha256: string, size: number, body: AsyncIterable<Buffer> | Iterable<Buffer>): Promise<void>;
  get(sha256: string): Promise<{ size: number; stream: Readable } | null>;
}

export interface PoolIndex {
  get(sourceUrl: string, path: string): Promise<{ sha256: string; size: number } | null>;
  set(sourceUrl: string, path: string, sha256: string, size: number): Promise<void>;
}

export type AptFetchImpl = (url: string) => Promise<Response>;

export const defaultAptFetch: AptFetchImpl = (url) =>
  fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60_000) });

/** Largest index / package file fetched (bytes). */
const MAX_INDEX_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 2 * 1024 ** 3;

async function download(fetchImpl: AptFetchImpl, url: string, maxBytes: number): Promise<Buffer> {
  const res = await fetchImpl(url);

  if (!res.ok || !res.body) throw new Error(`GET ${url}: HTTP ${res.status}`);

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;

    if (size > maxBytes) throw new Error(`GET ${url}: too large`);

    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks, size);
}

/**
 * Freezes the indexes of every source: `InRelease` per suite, and the `Packages` files it lists for the wanted
 * components / architectures (each checked against `InRelease`). Returns `<source>/dists/<suite>/<path>` → file.
 */
export async function takeSnapshot(
  upstreams: readonly AptUpstream[],
  store: BlobStore,
  fetchImpl: AptFetchImpl = defaultAptFetch,
): Promise<Record<string, { sha256: string; size: number }>> {
  const files: Record<string, { sha256: string; size: number }> = {};

  for (const upstream of upstreams)
    for (const suite of upstream.suites) {
      const base = `${upstream.url}/dists/${suite}`;
      const inRelease = await download(fetchImpl, `${base}/InRelease`, 16 * 1024 * 1024);
      const sha = sha256Hex(inRelease);

      if (!(await store.has(sha))) await store.put(sha, inRelease.length, [inRelease]);

      files[`${upstream.name}/dists/${suite}/InRelease`] = { sha256: sha, size: inRelease.length };

      for (const file of indexFiles(
        releaseChecksums(inRelease.toString('utf8')),
        upstream.components,
        upstream.arches,
      )) {
        const key = `${upstream.name}/dists/${suite}/${file.path}`;

        if (!(await store.has(file.sha256))) {
          const data = await download(fetchImpl, `${base}/${file.path}`, MAX_INDEX_BYTES);

          if (data.length !== file.size || sha256Hex(data) !== file.sha256)
            throw new Error(`${base}/${file.path} does not match its InRelease checksum`);

          await store.put(file.sha256, data.length, [data]);
        }

        files[key] = { sha256: file.sha256, size: file.size };
      }
    }

  return files;
}

export interface ServedFile {
  size: number;
  stream: Readable;
  contentType: string;
}

const inflight = new Map<string, Promise<{ sha256: string; size: number }>>();

/** Largest decompressed `Packages` index parsed for the pool allow-list. */
const MAX_PACKAGES_BYTES = 1024 ** 3;

/** `Filename` → `SHA256` / `Size` of the stanzas of a `Packages` index. */
export function parsePackagesIndex(text: string, into = new Map<string, { sha256: string; size: number }>()) {
  for (const stanza of text.split(/\r?\n\s*\r?\n/)) {
    const field = (name: string) => new RegExp(`^${name}:[ \\t]*(\\S+)[ \\t]*$`, 'm').exec(stanza)?.[1];
    const filename = field('Filename');
    const sha256 = field('SHA256')?.toLowerCase();
    const size = Number(field('Size'));

    if (filename && sha256 && /^[0-9a-f]{64}$/.test(sha256) && Number.isSafeInteger(size) && size >= 0)
      into.set(filename, { sha256, size });
  }

  return into;
}

async function xzDecompress(data: Buffer): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn('xz', ['-dc'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let size = 0;

    child.on('error', reject);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;

      if (size > MAX_PACKAGES_BYTES) child.kill();
      else chunks.push(chunk);
    });
    child.on('close', (code) =>
      code === 0 && size <= MAX_PACKAGES_BYTES
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`xz exited with ${code}`)),
    );
    child.stdin.on('error', () => undefined);
    child.stdin.end(data);
  });
}

/** Pool allow-lists per source of a snapshot (keyed by the frozen index checksums; small LRU). */
const allowLists = new Map<string, Promise<Map<string, { sha256: string; size: number }>>>();
const MAX_ALLOW_LISTS = 8;

/**
 * The frozen `Packages` indexes of one source to read, one per suite / component / architecture: the plain index if
 * frozen, else `.gz`, else `.xz`. Keyed by their directory (`<source>/dists/<suite>/<component>/binary-<arch>`).
 */
function chosenPackagesIndexes(
  files: Record<string, { sha256: string; size: number }>,
  sourceName: string,
): { dir: string; path: string; sha256: string; rank: number }[] {
  const indexes = new Map<string, { dir: string; path: string; sha256: string; rank: number }>();

  for (const [path, file] of Object.entries(files)) {
    const match = /^(.+)\/Packages(\.gz|\.xz)?$/.exec(path);

    if (!match || !path.startsWith(`${sourceName}/dists/`)) continue;

    const rank = match[2] === undefined ? 0 : match[2] === '.gz' ? 1 : 2;
    const current = indexes.get(match[1]);

    if (!current || rank < current.rank) indexes.set(match[1], { dir: match[1], path, sha256: file.sha256, rank });
  }

  return [...indexes.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Reads one frozen `Packages` index from the store (checked against its checksum) and decompresses it. */
async function readPackagesIndex(index: { path: string; sha256: string; rank: number }, store: BlobStore) {
  const found = await store.get(index.sha256);

  if (!found) throw new Error(`frozen index ${index.path} is missing from the store`);

  const chunks: Buffer[] = [];

  for await (const chunk of found.stream) chunks.push(Buffer.from(chunk as Buffer));

  const raw = Buffer.concat(chunks);

  if (sha256Hex(raw) !== index.sha256) throw new Error(`frozen index ${index.path} does not match its checksum`);

  const text =
    index.rank === 0
      ? raw
      : index.rank === 1
        ? gunzipSync(raw, { maxOutputLength: MAX_PACKAGES_BYTES })
        : await xzDecompress(raw);

  return text.toString('utf8');
}

/**
 * The decompressed frozen `Packages` indexes of one source (one per suite / component / architecture), e.g. for the
 * bundle builder's package selection (`apt-bundle.ts`).
 */
export async function frozenPackagesIndexes(
  files: Record<string, { sha256: string; size: number }>,
  sourceName: string,
  store: BlobStore,
): Promise<{ dir: string; text: string }[]> {
  const out: { dir: string; text: string }[] = [];

  for (const index of chosenPackagesIndexes(files, sourceName))
    out.push({ dir: index.dir, text: await readPackagesIndex(index, store) });

  return out;
}

/**
 * The pool files a snapshot's frozen `Packages` indexes name for one source, with their SHA-256 and size (M6 review
 * M3): only these are fetched from upstream, and only bytes matching them are stored and served. Per component /
 * architecture the plain index is read if frozen, else `.gz`, else `.xz` (the `xz` tool).
 */
export async function poolAllowList(
  files: Record<string, { sha256: string; size: number }>,
  sourceName: string,
  store: BlobStore,
): Promise<Map<string, { sha256: string; size: number }>> {
  const chosen = chosenPackagesIndexes(files, sourceName);
  const key = `${sourceName}\u0000${chosen.map((i) => i.sha256).join(',')}`;
  const cached = allowLists.get(key);

  if (cached) {
    allowLists.delete(key);
    allowLists.set(key, cached);

    return await cached;
  }

  const work = (async () => {
    const allowed = new Map<string, { sha256: string; size: number }>();

    for (const index of chosen) parsePackagesIndex(await readPackagesIndex(index, store), allowed);

    return allowed;
  })();

  allowLists.set(key, work);
  // Failures are not cached.
  work.catch(() => allowLists.delete(key));

  while (allowLists.size > MAX_ALLOW_LISTS) allowLists.delete(allowLists.keys().next().value as string);

  return await work;
}

/**
 * Fetches a pool file from upstream once (deduplicated) and stores it by checksum — only if it has exactly the size
 * and SHA-256 the snapshot's frozen index names (M6 review M3); mismatches and failures are neither stored nor cached.
 */
async function fetchPool(
  sourceUrl: string,
  path: string,
  expected: { sha256: string; size: number },
  store: BlobStore,
  pool: PoolIndex,
  fetchImpl: AptFetchImpl,
): Promise<{ sha256: string; size: number }> {
  const key = `${sourceUrl}\u0000${path}\u0000${expected.sha256}`;
  const running = inflight.get(key);

  if (running) return await running;

  const work = (async () => {
    if (expected.size > MAX_PACKAGE_BYTES) throw new Error('package too large');

    const res = await fetchImpl(`${sourceUrl}/${path}`);

    if (!res.ok || !res.body) throw new Error(`upstream answered HTTP ${res.status}`);

    // Spooled to a private temp file: the checksum is known only at the end, the store wants it up front.
    const temp = join(tmpdir(), `lw-apt-${randomUUID()}`);
    const file = await open(temp, 'w', 0o600);
    const hash = createHash('sha256');
    let size = 0;

    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;

        if (size > expected.size) throw new Error(`${path} is larger than its index entry`);

        hash.update(chunk);
        await file.write(chunk);
      }

      await file.close();

      const sha256 = hash.digest('hex');

      if (size !== expected.size || sha256 !== expected.sha256)
        throw new Error(`${path} does not match its Packages index entry`);

      if (!(await store.has(sha256))) await store.put(sha256, size, createReadStream(temp));

      await pool.set(sourceUrl, path, sha256, size);

      return { sha256, size };
    } finally {
      await file.close().catch(() => undefined);
      await rm(temp, { force: true });
    }
  })();

  inflight.set(key, work);

  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}

/**
 * One file of a snapshot for a node: indexes exactly as frozen (also by hash), packages from the store or fetched once
 * from the source's upstream — only pool files the snapshot's frozen `Packages` indexes list, verified against their
 * size and SHA-256 (M6 review M3). Unknown sources, paths outside `dists/` / `pool/`, indexes not in the snapshot and
 * pool files no frozen index names: null.
 */
export async function serveAptFile(
  snapshot: { sources: readonly AptUpstream[]; files: Record<string, { sha256: string; size: number }> },
  sourceName: string,
  path: string,
  store: BlobStore,
  pool: PoolIndex,
  fetchImpl: AptFetchImpl = defaultAptFetch,
): Promise<ServedFile | null> {
  const source = snapshot.sources.find((s) => s.name === sourceName);
  const kind = classifyAptPath(path);

  if (!source || !kind) return null;

  if (kind.kind === 'dist') {
    const file = kind.byHash
      ? Object.entries(snapshot.files).find(([k, f]) => k.startsWith(`${sourceName}/`) && f.sha256 === kind.byHash)?.[1]
      : snapshot.files[`${sourceName}/${path}`];

    if (!file) return null;

    const found = await store.get(file.sha256);

    return found ? { size: found.size, stream: found.stream, contentType: 'application/octet-stream' } : null;
  }

  const expected = (await poolAllowList(snapshot.files, sourceName, store)).get(path);

  if (!expected) return null;

  const cached = await pool.get(source.url, path);
  let known: { sha256: string; size: number };

  if (cached && cached.sha256 === expected.sha256 && cached.size === expected.size && (await store.has(cached.sha256)))
    known = cached;
  else if (await store.has(expected.sha256)) {
    // Already in the store by its checksum (a bundle's packages, air-gapped; or fetched for another source URL):
    // served from there, upstream is never asked.
    await pool.set(source.url, path, expected.sha256, expected.size);
    known = expected;
  } else known = await fetchPool(source.url, path, expected, store, pool, fetchImpl);
  const found = await store.get(known.sha256);

  return found
    ? { size: found.size, stream: found.stream, contentType: 'application/vnd.debian.binary-package' }
    : null;
}

/** In-memory pool index (tests, the VM lab). */
export function memoryPoolIndex(): PoolIndex {
  const entries = new Map<string, { sha256: string; size: number }>();

  return {
    get: async (url, path) => entries.get(`${url}\u0000${path}`) ?? null,
    set: async (url, path, sha256, size) => void entries.set(`${url}\u0000${path}`, { sha256, size }),
  };
}

export function bufferStream(data: Buffer): Readable {
  return Readable.from([data]);
}
