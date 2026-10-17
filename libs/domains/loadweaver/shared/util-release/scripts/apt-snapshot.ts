/**
 * Freezes the apt snapshot a release bundle carries for air-gapped clusters (3.26, `src/lib/apt-bundle.ts`):
 *
 *   npx nx run loadweaver-shared-util-release:apt-snapshot -- --release 3.6.0 \
 *     --host debian:12/amd64 --host debian:13/arm64 … [--package <name> …] [--out dist/apt]
 *
 * Writes `<out>/snapshot.json` (the index `build-bundle --apt-snapshot` takes), `<out>/blobs/<sha256>` (the frozen
 * indexes, `build-bundle --apt-files`) and `<out>/kernels/<os>-<arch>.txt` (the kernel releases the selection holds,
 * for `drbd-compat.sh`, so the compat patches match the snapshot's kernels). Upstreams: the defaults per OS, or
 * `LOADWEAVER_APT_SOURCES` (mirrors). Packages are fetched later by `build-bundle`, by the checksums in the index.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { buildAptBundleSnapshot, normalizeVersion, selectedKernels, type BlobStore } from '../src';

const { values } = parseArgs({
  options: {
    release: { type: 'string' },
    host: { type: 'string', multiple: true },
    package: { type: 'string', multiple: true },
    out: { type: 'string', default: 'dist/apt' },
  },
});

function fail(message: string): never {
  console.error(`apt-snapshot: ${message}`);
  process.exit(1);
}

function dirStore(dir: string): BlobStore {
  const path = (sha: string) => join(dir, sha);

  return {
    has: async (sha) => !!(await stat(path(sha)).catch(() => null)),
    put: async (sha, size, body) => {
      await mkdir(dir, { recursive: true });

      const temp = `${path(sha)}.${randomBytes(4).toString('hex')}`;
      const file = await open(temp, 'w', 0o644);
      const hash = createHash('sha256');
      let length = 0;

      try {
        for await (const chunk of body) {
          hash.update(chunk);
          length += chunk.length;
          await file.write(chunk);
        }
      } finally {
        await file.close();
      }

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

async function main(): Promise<void> {
  const version = normalizeVersion(values.release ?? process.env['VERSION'] ?? '') ?? fail('--release is required');
  const hosts = (values.host ?? []).map((spec) => {
    const match = /^([a-z]+:[0-9.]+)\/(amd64|arm64)$/.exec(spec) ?? fail(`--host ${spec}: expected <os>/<arch>`);

    return { os: match[1], arch: match[2] };
  });

  if (!hosts.length) fail('give at least one --host <os>/<arch>');

  const out = resolve(values.out as string);
  const { index, selections } = await buildAptBundleSnapshot(hosts, dirStore(join(out, 'blobs')), {
    id: `s-bundle-${version.replace(/[^0-9a-z]/gi, '-').toLowerCase()}`.slice(0, 63),
    extraPackages: values.package ?? [],
  });

  await mkdir(join(out, 'kernels'), { recursive: true });

  for (const [host, selection] of Object.entries(selections)) {
    const kernels = selectedKernels(selection.packages);
    const size = selection.pool.reduce((n, e) => n + e.size, 0);

    await writeFile(join(out, 'kernels', `${host.replace(/[:/]/g, '-')}.txt`), kernels.join('\n') + '\n');
    console.log(
      `apt-snapshot ${host}: ${selection.packages.length} packages, ${(size / 1024 ** 2).toFixed(0)} MiB, kernels ${kernels.join(' ') || '-'}`,
    );

    if (selection.missingRoots.length) console.log(`  not in the archives: ${selection.missingRoots.join(' ')}`);

    if (selection.missingPins.length) console.warn(`  pinned versions missing: ${selection.missingPins.join(' ')}`);

    if (selection.unresolved.length)
      console.warn(`  unresolved dependencies: ${selection.unresolved.slice(0, 20).join('; ')}`);
  }

  await writeFile(join(out, 'snapshot.json'), JSON.stringify(index));
  console.log(
    `apt-snapshot ${index.id}: ${Object.keys(index.files).length} index files, ${index.pool.length} package files`,
  );
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
