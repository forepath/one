import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { buildManifest, buildTar } from '@forepath/loadweaver/shared/util-release';

import { ArtifactStore } from './artifact-store';
import { bundleParts, bundleUrl } from './bundle.service';
import { contractReadiness } from './contract-migration.service';
import { importOciArchive } from './registry-import';

const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

describe('artifact store (local)', () => {
  const root = mkdtempSync(join(tmpdir(), 'lw-artifacts-'));

  beforeAll(() => {
    process.env['FILE_STORAGE_ROOT'] = root;
    process.env['FILE_STORAGE_PROVIDER'] = 'local';
  });

  it('stores by checksum, refuses mismatches and leaves nothing behind', async () => {
    const store = new ArtifactStore({} as never);
    const data = Buffer.from('agent binary');

    expect(await store.has(sha(data))).toBe(false);
    await expect(store.put(sha('other'), data.length, [data])).rejects.toThrow(/SHA-256/);
    expect(await store.has(sha('other'))).toBe(false);
    expect(await store.putBuffer(data)).toBe(sha(data));
    expect((await store.getBuffer(sha(data), 100))?.equals(data)).toBe(true);
    expect(await store.get('../../etc/passwd')).toBeNull();
    await expect(store.getBuffer(sha(data), 2)).rejects.toThrow(/too large/);
  });
});

describe('bundle sources', () => {
  it('reads a bundle published in parts as one stream', async () => {
    const parts: Record<string, string> = { 'https://x/b.tar.part000': 'abc', 'https://x/b.tar.part001': 'def' };
    const get = async (url: string) => (parts[url] ? new Response(parts[url]) : new Response('', { status: 404 }));
    const chunks: Buffer[] = [];

    for await (const c of bundleParts('https://x/b.tar', get)) chunks.push(Buffer.from(c));

    expect(Buffer.concat(chunks).toString()).toBe('abcdef');

    const none = bundleParts('https://x/missing.tar', get);

    await expect(none.next()).rejects.toThrow(/HTTP 404 for part 0/);
  });

  it('downloads from the GitHub release or the mirror', () => {
    expect(bundleUrl('3.5.0', { source: 'github' })).toBe(
      'https://github.com/forepath/one/releases/download/v3.5.0/loadweaver-bundle-3.5.0.tar',
    );
    expect(bundleUrl('3.5.0', { source: 'mirror', mirrorUrl: 'https://mirror.example/lw/' })).toBe(
      'https://mirror.example/lw/3.5.0/loadweaver-bundle-3.5.0.tar',
    );
  });
});

describe('contract migrations (3.26 expand / contract)', () => {
  const manifest = buildManifest({
    version: '3.5.0',
    channel: 'stable',
    created: '2026-10-19T00:00:00.000Z',
    images: { 'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:3.5.0@sha256:${'c'.repeat(64)}` },
    agentBinaries: {},
  });
  const node = (
    name: string,
    release: string,
    agent: string,
    controlPlane = false,
    cp = `x@sha256:${'c'.repeat(64)}`,
  ) => ({
    name,
    controlPlane,
    agentVersion: agent,
    componentVersions: { release, images: controlPlane ? { 'control-plane': cp } : {} },
  });

  it('runs only once every node and control-plane member is on the new version', () => {
    expect(
      contractReadiness('3.5.0', manifest, [node('m1', '3.5.0', '3.5.0', true), node('n1', '3.5.0', '3.5.0')]),
    ).toEqual({
      ready: true,
      version: '3.5.0',
      blockers: [],
    });
    expect(contractReadiness('3.5.0', manifest, [node('n1', '3.4.0', '3.4.0')]).blockers).toEqual(['n1 runs 3.4.0']);
    expect(contractReadiness('3.5.0', manifest, [node('n1', '3.5.0', '3.4.9')]).blockers).toEqual([
      'n1 runs agent 3.4.9',
    ]);
    expect(
      contractReadiness('3.5.0', manifest, [node('m1', '3.5.0', '3.5.0', true, `x@sha256:${'b'.repeat(64)}`)]).blockers,
    ).toEqual([expect.stringContaining('m1 runs control plane')]);
    expect(contractReadiness(null, null, []).ready).toBe(false);
  });
});

describe('registry import (OCI archives)', () => {
  let server: Server;
  let port: number;
  const blobs = new Map<string, Buffer>();
  const manifests = new Map<string, { type: string; body: Buffer }>();

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];

      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://x');

        if (req.headers.authorization !== 'Bearer t') return res.writeHead(401).end();

        if (req.method === 'HEAD' && url.pathname.includes('/blobs/'))
          return res.writeHead(blobs.has(url.pathname.split('/').pop() as string) ? 200 : 404).end();

        if (req.method === 'POST' && url.pathname.endsWith('/blobs/uploads/'))
          return res.writeHead(202, { location: '/v2/lw-system/envoy/blobs/uploads/u1?state=x' }).end();

        if (req.method === 'PUT' && url.pathname.includes('/blobs/uploads/')) {
          const digest = url.searchParams.get('digest') as string;
          const body = Buffer.concat(chunks);

          if (`sha256:${sha(body)}` !== digest) return res.writeHead(400).end('digest mismatch');

          blobs.set(digest, body);

          return res.writeHead(201).end();
        }

        if (req.method === 'PUT' && url.pathname.includes('/manifests/')) {
          manifests.set(url.pathname.split('/').pop() as string, {
            type: String(req.headers['content-type']),
            body: Buffer.concat(chunks),
          });

          return res.writeHead(201).end();
        }

        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => server.close());

  it('pushes blobs and manifests digest-preserving, children of an index first', async () => {
    const config = Buffer.from('{"architecture":"amd64"}');
    const layer = Buffer.alloc(5 * 1024 * 1024, 7);
    const manifest = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: { digest: `sha256:${sha(config)}` },
        layers: [{ digest: `sha256:${sha(layer)}` }],
      }),
    );
    const index = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.index.v1+json',
        manifests: [{ digest: `sha256:${sha(manifest)}` }],
      }),
    );
    const archive = buildTar([
      { name: 'oci-layout', data: '{"imageLayoutVersion":"1.0.0"}' },
      { name: 'index.json', data: JSON.stringify({ manifests: [{ digest: `sha256:${sha(index)}` }] }) },
      ...[config, layer, manifest, index].map((d) => ({ name: `blobs/sha256/${sha(d)}`, data: d })),
    ]);

    const ref = await importOciArchive(
      Readable.from([archive]),
      { host: '127.0.0.1', port, token: 't' },
      'envoy',
      `sha256:${sha(index)}`,
    );

    expect(ref).toBe(`lw-system/envoy@sha256:${sha(index)}`);
    expect(blobs.get(`sha256:${sha(layer)}`)?.equals(layer)).toBe(true);
    expect([...manifests.keys()]).toEqual([`sha256:${sha(manifest)}`, `sha256:${sha(index)}`]);
    expect(manifests.get(`sha256:${sha(index)}`)?.type).toBe('application/vnd.oci.image.index.v1+json');

    await expect(
      importOciArchive(
        Readable.from([archive]),
        { host: '127.0.0.1', port, token: 't' },
        'envoy',
        `sha256:${'0'.repeat(64)}`,
      ),
    ).rejects.toThrow(/doesn't contain/);
  });
});
