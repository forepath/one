import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseManifest, SEMVER_PATTERN } from '@forepath/loadweaver/shared/util-app-catalog';

import { RELEASE_FILE } from './catalog';
import { OciRegistryClient, parseOciTarget, type RegistryCredentials } from './oci';
import { readPackageDir } from './package-dir';

/** Resolves `registry/repository:tag` to the digest the tag points at. */
export type ResolveDigest = (image: string) => Promise<string>;

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/** Digest of `registry/repository:tag` through the registry API (anonymous pull token unless credentials are given). */
export function registryDigestResolver(
  credentials: RegistryCredentials = {},
  fetchImpl: typeof fetch = fetch,
): ResolveDigest {
  return async (image) => {
    const colon = image.lastIndexOf(':');
    const slash = image.indexOf('/');

    if (colon < slash || slash < 0) throw new Error(`${image}: expected registry/repository:tag`);

    const reference = image.slice(0, colon);
    const tag = image.slice(colon + 1);
    const target = parseOciTarget(`oci://${reference}`);
    const client = new OciRegistryClient(target, credentials, fetchImpl, 'pull');
    const res = await client.request(target.repository, 'HEAD', `/manifests/${tag}`, {
      headers: { accept: MANIFEST_ACCEPT },
    });
    const digest = res.headers.get('docker-content-digest');

    if (!res.ok || !digest) throw new Error(`${image}: HTTP ${res.status}${res.ok ? ' without a digest' : ''}`);

    return digest;
  };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `lw app bump`: copies a package version to a new version. Images tagged with the old version
 * (`<registry>/<repo>:<old>@sha256:…`, in services and in values such as worker image settings) are re-pinned to
 * `<repo>:<new>@<digest of the new tag>`; other images (databases, …) stay as they are. The manifest version, the
 * README's mentions of the old version and `release.yaml` follow.
 */
export async function bumpPackage(
  dir: string,
  version: string,
  outDir: string,
  resolve: ResolveDigest,
  now = new Date(),
): Promise<{ replaced: { from: string; to: string }[] }> {
  if (!SEMVER_PATTERN.test(version)) throw new Error(`${version} is not a semantic version`);

  const exists = await stat(outDir).then(
    () => true,
    () => false,
  );

  if (exists) throw new Error(`${outDir} already exists`);

  const files = await readPackageDir(dir);
  const manifest = parseManifest(files.manifest);

  if (!manifest.ok) throw new Error(`manifest.yaml: ${manifest.errors.join('; ')}`);

  const old = manifest.value.version;

  if (old === version) throw new Error(`${dir} already is version ${version}`);

  const pattern = new RegExp(`([a-z0-9.-]+(?::\\d+)?/[a-z0-9._/-]+):${escape(old)}@sha256:[0-9a-f]{64}`, 'g');
  const replaced: { from: string; to: string }[] = [];
  const resolved = new Map<string, string>();

  for (const match of files.compose.matchAll(pattern)) {
    if (resolved.has(match[0])) continue;

    const digest = await resolve(`${match[1]}:${version}`);
    const to = `${match[1]}:${version}@${digest}`;

    resolved.set(match[0], to);
    replaced.push({ from: match[0], to });
  }

  let compose = files.compose;

  for (const [from, to] of resolved) compose = compose.split(from).join(to);

  const manifestText = files.manifest.replace(new RegExp(`^version: ${escape(old)}$`, 'm'), `version: ${version}`);
  const readme = files.readme.split(old).join(version);

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'compose.yaml'), compose);
  await writeFile(join(outDir, 'manifest.yaml'), manifestText);
  await writeFile(join(outDir, 'README.md'), readme);

  const release = await readFile(join(dir, RELEASE_FILE), 'utf8').catch(() => '');
  const channel = /^channel:\s*(\S+)/m.exec(release)?.[1] ?? manifest.value.channels[0];

  await writeFile(
    join(outDir, RELEASE_FILE),
    `published: ${now.toISOString().replace(/\.\d{3}Z$/, 'Z')}\nchannel: ${channel}\n`,
  );

  return { replaced };
}
