import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  listFilesRecursive,
  releaseKeyId,
  sha256File,
  type ReleaseFile,
  type ReleaseImage,
} from '@forepath/shared/shared/util-release-signing';

/** Release tag of a container image target: `ghcr.io/forepath/<product>-<name>:$VERSION`. */
const RELEASE_TAG = /^([a-z0-9][a-z0-9.-]*(?::\d{1,5})?(?:\/[a-z0-9._-]+)+):\$VERSION$/;

/**
 * The images a product publishes in a release, read from the `release` configuration of the container image targets
 * of its apps (`apps/<product>/<app>/project.json`), so new images are covered without touching the workflow.
 */
export function discoverReleaseImages(appsRoot: string, product: string): { name: string; repository: string }[] {
  const dir = join(appsRoot, product);
  const found = new Map<string, string>();

  for (const app of existsSync(dir) ? readdirSync(dir).sort() : []) {
    const file = join(dir, app, 'project.json');

    if (!existsSync(file)) continue;

    const project = JSON.parse(readFileSync(file, 'utf8')) as {
      targets?: Record<string, { configurations?: { release?: { tags?: string[] } } }>;
    };

    for (const target of Object.values(project.targets ?? {})) {
      for (const tag of target.configurations?.release?.tags ?? []) {
        const repository = RELEASE_TAG.exec(tag)?.[1];

        if (!repository) continue;

        const base = repository.slice(repository.lastIndexOf('/') + 1);
        const name = base.startsWith(`${product}-`) ? base.slice(product.length + 1) : base;

        if (found.has(name) && found.get(name) !== repository) throw new Error(`two images named ${name}`);

        found.set(name, repository);
      }
    }
  }

  return [...found].map(([name, repository]) => ({ name, repository }));
}

export type DigestResolver = (reference: string) => string;

/** The registry's digest of a pushed image (the multi-arch index where there is one), without pulling it. */
export const resolveImageDigest: DigestResolver = (reference) =>
  execFileSync('docker', ['buildx', 'imagetools', 'inspect', reference, '--format', '{{json .Manifest.Digest}}'], {
    encoding: 'utf8',
  })
    .trim()
    .replace(/^"|"$/g, '');

export function pinReleaseImages(
  images: readonly { name: string; repository: string }[],
  tag: string,
  resolve: DigestResolver = resolveImageDigest,
): ReleaseImage[] {
  return images.map(({ name, repository }) => ({ name, repository, tag, digest: resolve(`${repository}:${tag}`) }));
}

/** `name=registry/repo:tag@sha256:…` (or without tag) as given on the command line. */
export function parseImageArgument(value: string): ReleaseImage {
  const match = /^([a-z0-9-]+)=([^@\s]+?)(?::([A-Za-z0-9_.-]{1,128}))?@(sha256:[0-9a-f]{64})$/.exec(value);

  if (!match) throw new Error(`--image expects name=repository[:tag]@sha256:<digest>, got ${value}`);

  return { name: match[1], repository: match[2], ...(match[3] ? { tag: match[3] } : {}), digest: match[4] };
}

/** Every file below `dir`, listed as `<prefix>/<relative path>` (the layout the files are published under). */
export async function collectReleaseFiles(prefix: string, dir: string): Promise<ReleaseFile[]> {
  const out: ReleaseFile[] = [];

  for (const rel of await listFilesRecursive(dir)) {
    out.push({ path: `${prefix}/${rel}`, ...(await sha256File(join(dir, ...rel.split('/')))) });
  }

  return out;
}

/**
 * The signing key's id, refused unless the product trusts it: a manifest signed with a key nobody can verify would
 * only look signed.
 */
export function assertTrustedSigningKey(keyId: string, trusted: readonly string[], product: string): void {
  if (!trusted.some((pem) => releaseKeyId(pem) === keyId))
    throw new Error(
      `the ${product} signing key (key id ${keyId}) is not in the ${product} release keys of this repository; add its public key first`,
    );
}

export function readPemFiles(paths: readonly string[]): string[] {
  return paths.map((p) => readFileSync(p, 'utf8'));
}
