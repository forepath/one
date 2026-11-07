import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export interface FileDigest {
  sha256: string;
  size: number;
}

/** SHA-256 and size of a file, streamed (release artifacts can be several GB). */
export async function sha256File(path: string): Promise<FileDigest> {
  const hash = createHash('sha256');
  let size = 0;

  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }

  return { sha256: hash.digest('hex'), size };
}

/** Regular files below `root` as `/`-separated relative paths, sorted; symlinks and other entries are skipped. */
export async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join('/'));
    }
  }

  if (!(await stat(root)).isDirectory()) throw new Error(`${root} is not a directory`);

  await walk(root);

  return out.sort();
}
