import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { readTar } from './tar';

/**
 * DRBD compat patches pre-generated at bundle build time (3.26, air-gapped clusters).
 *
 * DRBD 9 adapts its sources to a kernel with a "compat patch": the build probes the kernel headers into `compat.h`,
 * then looks up `drbd-kernel-compat/cocci_cache/<md5 of compat.h>/compat.patch`; without a cache entry it runs a
 * local coccinelle (`spatch`) or asks LINBIT's spatch-as-a-service (SPAAS) over the internet. Nodes have neither
 * (air-gapped, no coccinelle), so the release pipeline generates the entry for every kernel the release's snapshot
 * installs (`scripts/drbd-compat.sh`, in a container of that OS / architecture, where the network is fine) and the
 * bundle ships it, checksummed and covered by the signature. The node agent extracts it into the source tree and
 * builds with `SPAAS=false`: no network at build time, a kernel without an entry fails before anything changes.
 *
 * An entry is a `.tar.gz` of exactly `cocci_cache/<md5>/compat.h`, `compat.patch` and `kernelrelease.txt`
 * (directories allowed), relative to `drbd/drbd-kernel-compat/`.
 */

export interface DrbdCompatEntry {
  /** MD5 of `compat.h` (the cache directory). */
  md5: string;
  /** Kernel releases listed in `kernelrelease.txt`. */
  kernels: string[];
  /** Size of `compat.patch` (0: the kernel needs no patch). */
  patchBytes: number;
}

async function* once(data: Buffer): AsyncGenerator<Buffer> {
  yield data;
}

const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const FILES = ['compat.h', 'compat.patch', 'kernelrelease.txt'] as const;

/**
 * Validates a compat entry (`.tar.gz` bytes) for `kernel`: only the three files of one `cocci_cache/<md5>/` directory,
 * `md5` matching `compat.h`, the kernel listed in `kernelrelease.txt`. Throws on anything else.
 */
export async function inspectDrbdCompatEntry(tgz: Buffer, kernel: string): Promise<DrbdCompatEntry> {
  const tar = gunzipSync(tgz, { maxOutputLength: MAX_ENTRY_BYTES });
  const files: Partial<Record<(typeof FILES)[number], Buffer>> = {};
  let dir: string | undefined;

  for await (const entry of readTar(once(tar), { maxEntryBytes: MAX_ENTRY_BYTES })) {
    const match = /^cocci_cache(?:\/([0-9a-f]{32})(?:\/([^/]+))?)?$/.exec(entry.name);

    if (!match) throw new Error(`DRBD compat entry: unexpected path ${entry.name}`);

    if (match[1]) {
      if (dir && dir !== match[1]) throw new Error('DRBD compat entry: more than one cache directory');

      dir = match[1];
    }

    if (entry.type === 'directory') {
      if (match[2]) throw new Error(`DRBD compat entry: unexpected directory ${entry.name}`);

      continue;
    }

    const name = match[2] as (typeof FILES)[number] | undefined;

    if (!name || !FILES.includes(name)) throw new Error(`DRBD compat entry: unexpected file ${entry.name}`);

    if (files[name]) throw new Error(`DRBD compat entry: duplicate ${entry.name}`);

    const chunks: Buffer[] = [];

    for await (const chunk of entry.body) chunks.push(chunk);

    files[name] = Buffer.concat(chunks);
  }

  for (const name of FILES)
    if (!files[name]) throw new Error(`DRBD compat entry: cocci_cache/<md5>/${name} is missing`);

  const md5 = createHash('md5')
    .update(files['compat.h'] as Buffer)
    .digest('hex');

  if (md5 !== dir) throw new Error(`DRBD compat entry: compat.h has MD5 ${md5}, its directory says ${dir}`);

  const kernels = (files['kernelrelease.txt'] as Buffer)
    .toString('utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (!kernels.includes(kernel)) throw new Error(`DRBD compat entry: kernelrelease.txt does not list ${kernel}`);

  return { md5, kernels, patchBytes: (files['compat.patch'] as Buffer).length };
}
