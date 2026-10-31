/**
 * VM lab stand-in for the control plane's update file routes (3.26), bundled with esbuild by the VM lab global setup.
 * Runs the real frozen-index apt source (`takeSnapshot` / `serveAptFile` from util-release, as the control plane's
 * `AptSnapshotService` does) with a directory store instead of the object store, and serves release artifacts by
 * checksum — so a lab VM can play "the cluster" the nodes fetch from.
 *
 * usage: node apt-source.js snapshot <dir> <upstreams.json>   → <dir>/snapshot.json { id, sources, files }
 *        node apt-source.js serve <dir> <port>
 *        node apt-source.js put <dir> <file>                    → stores an artifact, prints its sha256
 *
 * Routes: GET /api/updates/apt/<snapshot>/<source>/<path…>, GET /api/updates/artifacts/<sha256>
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import {
  serveAptFile,
  snapshotId,
  takeSnapshot,
  validateUpstream,
  type AptUpstream,
  type BlobStore,
  type PoolIndex,
} from '@forepath/loadweaver/shared/util-release';

function dirStore(dir: string): BlobStore {
  const path = (sha: string) => join(dir, 'blobs', sha);

  return {
    has: async (sha) => !!(await stat(path(sha)).catch(() => null)),
    put: async (sha, size, body) => {
      await mkdir(join(dir, 'blobs'), { recursive: true });

      const temp = `${path(sha)}.${randomBytes(4).toString('hex')}`;
      const file = await open(temp, 'w');
      const hash = createHash('sha256');
      let length = 0;

      for await (const chunk of body) {
        hash.update(chunk);
        length += chunk.length;
        await file.write(chunk);
      }

      await file.close();

      if (length !== size || hash.digest('hex') !== sha) {
        await rm(temp, { force: true });
        throw new Error(`blob ${sha} does not match`);
      }

      await rename(temp, path(sha));
    },
    get: async (sha) => {
      const info = await stat(path(sha)).catch(() => null);

      return info ? { size: info.size, stream: createReadStream(path(sha)) } : null;
    },
  };
}

/**
 * Pool index in one JSON file. apt fetches several packages at once: writes are serialized and replace the file
 * atomically (temp + rename) — a plain rewrite let a concurrent read see a half-written file (JSON parse error → 404
 * for that package, seen in the kernel-update lab).
 */
function filePool(dir: string): PoolIndex {
  const file = join(dir, 'pool.json');
  const load = async () =>
    JSON.parse(await readFile(file, 'utf8').catch(() => '{}')) as Record<string, { sha256: string; size: number }>;
  let writes: Promise<void> = Promise.resolve();

  return {
    get: async (url, path) => (await load())[`${url} ${path}`] ?? null,
    set: async (url, path, sha256, size) => {
      const write = writes.then(async () => {
        const entries = await load();
        const temp = `${file}.${randomBytes(4).toString('hex')}`;

        entries[`${url} ${path}`] = { sha256, size };
        await writeFile(temp, JSON.stringify(entries));
        await rename(temp, file);
      });

      writes = write.catch(() => undefined);
      await write;
    },
  };
}

async function main(): Promise<void> {
  const [command, dir, arg] = process.argv.slice(2);

  if (!dir) throw new Error('usage: apt-source.js snapshot|serve|put <dir> …');

  const store = dirStore(dir);

  if (command === 'snapshot') {
    const sources = JSON.parse(await readFile(arg, 'utf8')) as AptUpstream[];

    sources.forEach(validateUpstream);

    const files = await takeSnapshot(sources, store);
    const id = snapshotId(new Date(), randomBytes(3).toString('hex'));

    await writeFile(join(dir, 'snapshot.json'), JSON.stringify({ id, sources, files }));
    process.stdout.write(`${id}\n`);

    return;
  }

  if (command === 'put') {
    const data = await readFile(arg);
    const sha = createHash('sha256').update(data).digest('hex');

    if (!(await store.has(sha))) await store.put(sha, data.length, [data]);

    process.stdout.write(`${sha}\n`);

    return;
  }

  if (command !== 'serve') throw new Error(`unknown command ${command}`);

  const snapshot = JSON.parse(
    await readFile(join(dir, 'snapshot.json'), 'utf8').catch(() => '{"id":"","sources":[],"files":{}}'),
  ) as {
    id: string;
    sources: AptUpstream[];
    files: Record<string, { sha256: string; size: number }>;
  };
  const pool = filePool(dir);

  createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://lab');
      const artifact = /^\/api\/updates\/artifacts\/([0-9a-f]{64})$/.exec(url.pathname);
      // apt percent-encodes some characters of package file names (`~` → `%7e`); the routes match decoded paths, as
      // the control plane's router does.
      const apt = /^\/api\/updates\/apt\/([a-z0-9-]+)\/([a-z0-9-]+)\/(.+)$/.exec(decodeURIComponent(url.pathname));
      const found = artifact
        ? await store.get(artifact[1])
        : apt && apt[1] === snapshot.id
          ? await serveAptFile(snapshot, apt[2], apt[3], store, pool).catch((error: unknown) => {
              // The reason in the journal (the control plane logs it too); apt only sees a 404.
              process.stderr.write(`${url.pathname}: ${error instanceof Error ? error.message : String(error)}\n`);

              return null;
            })
          : null;

      process.stderr.write(`${req.method} ${url.pathname} ${found ? 200 : 404}\n`);

      if (!found) {
        res.writeHead(404);
        res.end();

        return;
      }

      res.writeHead(200, { 'content-length': String(found.size), 'content-type': 'application/octet-stream' });
      found.stream.pipe(res);
    })();
  }).listen(Number(arg), '0.0.0.0');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
