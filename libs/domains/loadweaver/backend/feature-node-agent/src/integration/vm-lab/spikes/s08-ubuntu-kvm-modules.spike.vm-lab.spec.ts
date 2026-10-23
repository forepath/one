import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type BlobStore,
  buildAptBundleSnapshot,
  kernelsWithoutKvmModules,
  selectedKernels,
} from '@forepath/loadweaver/shared/util-release';

import { spikeRecorder } from './spike-lab';

/**
 * Spike S8 — Ubuntu bundle roots: do `linux-image-extra-virtual` and `linux-image-extra-virtual-hwe-<version>` (the
 * roots util-release adds for Ubuntu) pull `linux-modules-extra-<k>` for every kernel the bundle carries, on amd64
 * and arm64, for 22.04 and 24.04? Runs the real bundle selection (`buildAptBundleSnapshot` over today's upstream
 * indexes) in the test process — no VM, no Docker; needs internet.
 */
const rec = spikeRecorder({
  id: 'S8',
  title: 'Ubuntu bundle roots resolve linux-modules-extra for every bundled kernel',
  validates:
    'M7.1 "KVM host preparation through pins": KVM modules come from the cluster\'s apt snapshot only; util-release `bundleAptRoots` roots + `kernelsWithoutKvmModules`',
  ifFails:
    'add the missing `linux-modules-extra-<k>` (or the flavour metapackage, e.g. linux-modules-extra-virtual / -generic-hwe) as explicit roots per OS / arch in `bundleAptRoots`, and keep the apt-snapshot warning',
});

/** A blob store in a temporary directory (as scripts/apt-snapshot.ts). */
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

describe('spike S8: Ubuntu KVM modules in the bundle', () => {
  let dir = '';

  afterAll(async () => {
    rec.flush();

    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('selects linux-modules-extra for every bundled Ubuntu kernel (amd64 + arm64, 22.04 + 24.04)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-spike-s8-'));

    const hosts = ['ubuntu:22.04', 'ubuntu:24.04'].flatMap((os) => ['amd64', 'arm64'].map((arch) => ({ os, arch })));
    const snapshot = await rec.time('apt bundle selection (indexes only)', () =>
      buildAptBundleSnapshot(hosts, dirStore(dir)),
    );

    for (const { os, arch } of hosts) {
      const selection = snapshot.selections[`${os}/${arch}`];
      const kernels = selectedKernels(selection.packages);
      const missing = kernelsWithoutKvmModules(os, selection.packages);

      rec.note(`${os}/${arch} kernels`, kernels);

      if (selection.missingRoots.length) rec.note(`${os}/${arch} missing roots`, selection.missingRoots);

      rec.verdict(
        `${os}/${arch}: every kernel has linux-modules-extra`,
        kernels.length > 0 && missing.length === 0,
        missing.join(', '),
      );
    }

    expect(rec.verdicts.every((v) => v.pass)).toBe(true);
  }, 1_800_000);
});
