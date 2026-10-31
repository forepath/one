import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { docker } from './process';

/**
 * Persistent lab cache of this machine (both labs): Docker image archives keyed by image ID and the keep-alive state
 * of kept labs. Lives outside `/tmp` (WSL clears it on restart): `$VM_LAB_CACHE_DIR`, default
 * `~/.cache/forepath-vm-lab`. Golden images stay Docker volumes (content-addressed by the products).
 */
export const VM_LAB_CACHE_DIR_ENV = 'VM_LAB_CACHE_DIR';

export function labCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env[VM_LAB_CACHE_DIR_ENV] || join(homedir(), '.cache', 'forepath-vm-lab');
}

/** File-name safe form of an image reference (`registry/repo:tag` → `registry_repo_tag`). */
export function imageArchiveStem(image: string): string {
  return image.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 120);
}

/** Archive file of `image` with the image ID `id` (`sha256:…`). */
export function imageArchiveName(image: string, id: string): string {
  return `${imageArchiveStem(image)}--${id.replace(/^sha256:/, '').slice(0, 16)}.tar`;
}

/** The lab host's image ID of `image` (`sha256:…`). */
export async function hostImageId(image: string): Promise<string> {
  return (await docker(['image', 'inspect', '-f', '{{.Id}}', image])).trim();
}

/**
 * Where a VM records which host image ID it loaded for an image reference (`Vm.loadImage`): image IDs differ between
 * the lab host and a guest with the containerd image store, so the host ID is the only stable comparison.
 */
export function loadedImageMarker(image: string): string {
  return `/var/lib/vm-lab/images/${imageArchiveStem(image)}.id`;
}

/**
 * `docker save` of a local image, once per image ID: `<cache>/images/<image>--<id>.tar`. A rebuilt image (same tag,
 * new ID) gets a new archive and the older archives of that tag are removed, so the cache holds one archive per tag.
 */
export async function imageArchive(
  image: string,
  options: { dir?: string; log?: (line: string) => void } = {},
): Promise<string> {
  const dir = options.dir ?? join(labCacheDir(), 'images');
  const id = await hostImageId(image);
  const name = imageArchiveName(image, id);
  const file = join(dir, name);

  if (existsSync(file) && statSync(file).size > 0) return file;

  mkdirSync(dir, { recursive: true });

  const partial = `${file}.${process.pid}.part`;
  const start = Date.now();

  try {
    await docker(['image', 'save', '-o', partial, image], { timeoutMs: 15 * 60_000 });
    renameSync(partial, file);
  } finally {
    rmSync(partial, { force: true });
  }

  const stem = `${imageArchiveStem(image)}--`;

  for (const other of readdirSync(dir))
    if (other.startsWith(stem) && other !== name && other.endsWith('.tar')) rmSync(join(dir, other), { force: true });

  options.log?.(`image archive ${name} saved in ${Math.round((Date.now() - start) / 1000)}s`);

  return file;
}
