import { request } from 'node:http';
import type { Readable } from 'node:stream';

import { readAll, readTar } from '@forepath/loadweaver/shared/util-release';

/** Repository namespace of release images in the cluster registry (3.26). */
export const SYSTEM_REPOSITORY_PREFIX = 'lw-system';

const SMALL_BLOB_BYTES = 4 * 1024 * 1024;
const BLOB = /^blobs\/sha256\/([0-9a-f]{64})$/;
const MANIFEST_TYPES = new Set([
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
]);

export interface RegistryEndpoint {
  host: string;
  port: number;
  token: string;
}

interface Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function call(
  endpoint: RegistryEndpoint,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: Buffer | AsyncIterable<Buffer>; length?: number } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: endpoint.host.replace(/^\[|\]$/g, ''),
        port: endpoint.port,
        method,
        path,
        timeout: 120_000,
        headers: {
          authorization: `Bearer ${endpoint.token}`,
          ...(options.length !== undefined ? { 'content-length': String(options.length) } : {}),
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (c: Buffer) => chunks.length < 64 && chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );

    req.on('timeout', () => req.destroy(new Error(`registry ${method} ${path}: timeout`)));
    req.on('error', reject);

    const body = options.body;

    if (!body) return void req.end();

    if (Buffer.isBuffer(body)) return void req.end(body);

    void (async () => {
      try {
        for await (const chunk of body) if (!req.write(chunk)) await new Promise((r) => req.once('drain', r));

        req.end();
      } catch (error) {
        req.destroy(error as Error);
      }
    })();
  });
}

/** Uploads one blob (monolithic PUT after a POST); skipped when the repository already has it. */
export async function pushBlob(
  endpoint: RegistryEndpoint,
  repository: string,
  digest: string,
  size: number,
  body: Buffer | AsyncIterable<Buffer>,
): Promise<void> {
  const head = await call(endpoint, 'HEAD', `/v2/${repository}/blobs/${digest}`);

  if (head.status === 200) {
    if (!Buffer.isBuffer(body)) for await (const _ of body) void _;

    return;
  }

  const start = await call(endpoint, 'POST', `/v2/${repository}/blobs/uploads/`, { length: 0 });
  const location = start.headers['location'];

  if (start.status !== 202 || typeof location !== 'string')
    throw new Error(`registry refused the upload of ${digest} (${start.status}): ${start.body.slice(0, 200)}`);

  // Locations may be absolute; only the path + query is used (the registry is addressed directly).
  const url = new URL(location, 'http://registry.invalid');

  url.searchParams.set('digest', digest);

  const done = await call(endpoint, 'PUT', `${url.pathname}${url.search}`, {
    body,
    length: size,
    headers: { 'content-type': 'application/octet-stream' },
  });

  if (done.status !== 201)
    throw new Error(`registry refused blob ${digest} (${done.status}): ${done.body.slice(0, 200)}`);
}

/** Puts a manifest by tag or digest (VM image artifacts, 3.35). */
export async function pushManifest(
  endpoint: RegistryEndpoint,
  repository: string,
  reference: string,
  mediaType: string,
  data: Buffer,
): Promise<void> {
  const res = await call(endpoint, 'PUT', `/v2/${repository}/manifests/${reference}`, {
    body: data,
    length: data.length,
    headers: { 'content-type': mediaType },
  });

  if (res.status !== 201)
    throw new Error(`registry refused manifest ${reference} (${res.status}): ${res.body.slice(0, 200)}`);
}

/**
 * Pushes an OCI image archive (OCI layout in a tar: `index.json`, `blobs/sha256/…`) into the cluster registry as
 * `lw-system/<component>`, digest-preserving: every blob goes up as it is, then the manifests (children of an index
 * first) by digest. Fails when the archive doesn't contain the expected image digest.
 */
export async function importOciArchive(
  archive: Readable,
  endpoint: RegistryEndpoint,
  component: string,
  expectedDigest: string,
): Promise<string> {
  const repository = `${SYSTEM_REPOSITORY_PREFIX}/${component}`;
  const small = new Map<string, Buffer>();
  let index: { manifests?: { digest: string; mediaType?: string }[] } | null = null;

  for await (const entry of readTar(archive)) {
    if (entry.type !== 'file') continue;

    if (entry.name === 'index.json') {
      index = JSON.parse((await readAll(entry.body, 1024 * 1024)).toString('utf8'));
      continue;
    }

    const match = BLOB.exec(entry.name);

    if (!match) continue;

    const digest = `sha256:${match[1]}`;

    if (entry.size <= SMALL_BLOB_BYTES) {
      const data = await readAll(entry.body, SMALL_BLOB_BYTES);

      small.set(digest, data);
      await pushBlob(endpoint, repository, digest, data.length, data);
    } else {
      await pushBlob(endpoint, repository, digest, entry.size, entry.body);
    }
  }

  const document = small.get(expectedDigest);

  if (!index || !document) throw new Error(`the archive of ${component} doesn't contain ${expectedDigest}`);

  const putManifest = async (digest: string, depth = 0): Promise<void> => {
    const data = small.get(digest);

    if (!data) return;

    const parsed = JSON.parse(data.toString('utf8')) as { mediaType?: string; manifests?: { digest: string }[] };
    const mediaType =
      parsed.mediaType ??
      (parsed.manifests ? 'application/vnd.oci.image.index.v1+json' : 'application/vnd.oci.image.manifest.v1+json');

    if (!MANIFEST_TYPES.has(mediaType)) throw new Error(`unsupported manifest type ${mediaType}`);

    // Children of an index first (platforms missing from the archive are left out by the registry's own check).
    if (parsed.manifests && depth < 2) for (const child of parsed.manifests) await putManifest(child.digest, depth + 1);

    const res = await call(endpoint, 'PUT', `/v2/${repository}/manifests/${digest}`, {
      body: data,
      length: data.length,
      headers: { 'content-type': mediaType },
    });

    if (res.status !== 201)
      throw new Error(`registry refused manifest ${digest} (${res.status}): ${res.body.slice(0, 200)}`);
  };

  await putManifest(expectedDigest);

  return `${repository}@${expectedDigest}`;
}
