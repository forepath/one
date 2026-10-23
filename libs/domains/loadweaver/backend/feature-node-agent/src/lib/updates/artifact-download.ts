import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';

import type { FetchImpl } from '../host/verified-download';

/**
 * Downloads a release artifact to `path`, streaming (agent binaries and tarballs don't fit comfortably in memory) and
 * checking it on the way: at most `maxBytes`, then the SHA-256 (and SHA-512 where the manifest pins one) must match
 * before the file appears under its name. A matching file already in place is kept.
 */
export async function downloadVerified(
  url: string,
  path: string,
  expected: { sha256?: string; sha512?: string; size?: number },
  fetchImpl: FetchImpl,
  maxBytes: number,
): Promise<void> {
  if (!expected.sha256 && !expected.sha512) throw new Error('no checksum to verify the download against');

  if (await matches(path, expected)) return;

  const res = await fetchImpl(url);

  if (!res.ok || !res.body) throw new Error(`download of ${new URL(url).pathname} failed: HTTP ${res.status}`);

  const temp = `${path}.part`;
  const file = await open(temp, 'w', 0o600);
  const sha256 = createHash('sha256');
  const sha512 = createHash('sha512');
  let size = 0;

  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;

      if (size > maxBytes) throw new Error('download exceeds the size limit');

      sha256.update(chunk);
      sha512.update(chunk);
      await file.write(chunk);
    }

    await file.sync();
  } catch (error) {
    await file.close();
    await rm(temp, { force: true });
    throw error;
  }

  await file.close();

  const ok =
    (expected.size === undefined || expected.size === size) &&
    (!expected.sha256 || sha256.digest('hex') === expected.sha256) &&
    (!expected.sha512 || sha512.digest('hex') === expected.sha512);

  if (!ok) {
    await rm(temp, { force: true });
    throw new Error(`download of ${new URL(url).pathname} does not match the signed manifest`);
  }

  await rename(temp, path);
}

/** Whether a local file already has the expected content. */
export async function matches(
  path: string,
  expected: { sha256?: string; sha512?: string; size?: number },
): Promise<boolean> {
  const info = await stat(path).catch(() => null);

  if (!info?.isFile() || (expected.size !== undefined && info.size !== expected.size)) return false;

  const sha256 = createHash('sha256');
  const sha512 = createHash('sha512');

  for await (const chunk of createReadStream(path)) {
    sha256.update(chunk as Buffer);
    sha512.update(chunk as Buffer);
  }

  return (
    (!expected.sha256 || sha256.digest('hex') === expected.sha256) &&
    (!expected.sha512 || sha512.digest('hex') === expected.sha512)
  );
}
