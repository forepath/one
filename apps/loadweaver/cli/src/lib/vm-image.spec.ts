import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as zlib from 'node:zlib';

import { buildTar } from '@forepath/loadweaver/shared/util-release';

import { Api } from './api';
import { grantsPush, inspectDisk, parseVmImageTarget, pushVmImage } from './vm-image';

const sha = (data: Buffer) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

function qcow2(virtualSize: number, backing = false): Buffer {
  const header = Buffer.alloc(1024);

  header.writeUInt32BE(0x514649fb, 0);
  header.writeUInt32BE(3, 4);

  if (backing) header.writeBigUInt64BE(BigInt(512), 8);

  header.writeBigUInt64BE(BigInt(virtualSize), 24);

  return header;
}

function jwt(access: { type: string; name: string; actions: string[] }[]): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

  return `${part({ alg: 'ES256' })}.${part({ access })}.sig`;
}

const noQemu = async () => null;

describe('CLI vm-image push (3.35)', () => {
  let server: Server;
  let base = '';
  let pushAllowed = true;
  const blobs = new Map<string, Buffer>();
  const uploads = new Map<string, Buffer[]>();
  const manifests = new Map<string, { type: string; body: Buffer }>();
  const requests: { method: string; path: string; auth?: string; range?: string }[] = [];
  let uploadId = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];

      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://x');
        const body = Buffer.concat(chunks);

        requests.push({
          method: req.method ?? '',
          path: url.pathname,
          auth: req.headers.authorization,
          range: req.headers['content-range'] as string | undefined,
        });

        if (url.pathname === '/api/registry/token') {
          const scope = url.searchParams.get('scope') ?? '';
          const repository = scope.split(':')[1];

          res.setHeader('content-type', 'application/json');

          return res.end(
            JSON.stringify({
              token: jwt([
                { type: 'repository', name: repository, actions: pushAllowed ? ['pull', 'push'] : ['pull'] },
              ]),
            }),
          );
        }

        if (req.headers.authorization?.startsWith('Bearer ey') !== true) {
          res.statusCode = 401;

          return res.end();
        }

        const blob = /^\/v2\/(.+)\/blobs\/(sha256:[0-9a-f]{64})$/.exec(url.pathname);

        if (blob && req.method === 'HEAD') {
          res.statusCode = blobs.has(blob[2]) ? 200 : 404;

          return res.end();
        }

        if (/^\/v2\/.+\/blobs\/uploads\/$/.test(url.pathname) && req.method === 'POST') {
          const id = `u${++uploadId}`;

          uploads.set(id, []);
          res.statusCode = 202;
          // Absolute location with the registry's own host: the CLI uses the path only.
          res.setHeader('location', `http://registry.internal:5000${url.pathname}${id}?_state=s0`);

          return res.end();
        }

        const upload = /^\/v2\/.+\/blobs\/uploads\/(u\d+)$/.exec(url.pathname);

        if (upload && req.method === 'PATCH') {
          uploads.get(upload[1])?.push(body);
          res.statusCode = 202;
          res.setHeader('location', `${url.pathname}?_state=s${uploads.get(upload[1])?.length}`);

          return res.end();
        }

        if (upload && req.method === 'PUT') {
          const data = Buffer.concat(uploads.get(upload[1]) ?? []);
          const digest = url.searchParams.get('digest') ?? '';

          if (sha(data) !== digest) {
            res.statusCode = 400;

            return res.end('DIGEST_INVALID');
          }

          blobs.set(digest, data);
          res.statusCode = 201;

          return res.end();
        }

        const manifest = /^\/v2\/(.+)\/manifests\/(.+)$/.exec(url.pathname);

        if (manifest && req.method === 'PUT') {
          manifests.set(`${manifest[1]}:${manifest[2]}`, { type: req.headers['content-type'] ?? '', body });
          res.statusCode = 201;

          return res.end();
        }

        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  beforeEach(() => {
    requests.length = 0;
    pushAllowed = true;
  });

  const api = () => new Api({ url: base, token: 'lw_session' });
  const manifestOf = (key: string) => JSON.parse(manifests.get(key)?.body.toString('utf8') ?? '{}');

  it('parses targets in the project namespace of the built-in registry', () => {
    expect(parseVmImageTarget('shop/debian-13:20261017', 'https://cp.example.com/')).toEqual({
      base: 'https://cp.example.com',
      project: 'shop',
      repository: 'shop/debian-13',
      tag: '20261017',
    });
    expect(parseVmImageTarget('registry.lw/shop/os/debian', 'https://cp.example.com').tag).toBe('latest');
    expect(parseVmImageTarget('cp.example.com/shop/debian:1', 'https://cp.example.com').base).toBe(
      'https://cp.example.com',
    );
    expect(parseVmImageTarget('registry.example.org/shop/debian:1', 'https://cp.example.com').base).toBe(
      'https://registry.example.org',
    );
    expect(() => parseVmImageTarget('debian:1', 'https://cp.example.com')).toThrow('invalid image reference');
    expect(() => parseVmImageTarget('Shop/debian:1', 'https://cp.example.com')).toThrow('invalid image reference');
  });

  it('reads format and virtual size from qemu-img or the header, refusing backing files and other formats', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lw-vm-disk-'));
    const q = join(dir, 'a.qcow2');
    const raw = join(dir, 'a.img');

    await writeFile(q, qcow2(10 * 1024 ** 3));
    await writeFile(raw, Buffer.alloc(4096, 1));

    expect(await inspectDisk(q, noQemu)).toEqual({ format: 'qcow2', virtualSize: 10 * 1024 ** 3 });
    expect(await inspectDisk(raw, noQemu)).toEqual({ format: 'raw', virtualSize: 4096 });
    await expect(inspectDisk(raw, noQemu, 'qcow2')).rejects.toThrow('is raw, not qcow2');

    await writeFile(q, qcow2(1024, true));
    await expect(inspectDisk(q, noQemu)).rejects.toThrow('backing file');
    await expect(inspectDisk(q, async () => ({ format: 'vmdk', 'virtual-size': 1 }))).rejects.toThrow(
      'convert it first',
    );
    expect(await inspectDisk(q, async () => ({ format: 'qcow2', 'virtual-size': 2048 }))).toEqual({
      format: 'qcow2',
      virtualSize: 2048,
    });
  });

  it('pushes a qcow2 disk as a VM image artifact and skips layers the registry has', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lw-vm-push-'));
    const file = join(dir, 'debian.qcow2');
    const disk = Buffer.concat([qcow2(20 * 1024 ** 3), Buffer.alloc(8192, 7)]);
    const lines: string[] = [];

    await writeFile(file, disk);

    const reference = await pushVmImage(
      api(),
      { file, reference: 'shop/debian-13:1', firmware: 'uefi,bios', guestAgent: true },
      (l) => lines.push(l),
      noQemu,
    );
    const manifest = manifestOf('shop/debian-13:1');

    expect(manifests.get('shop/debian-13:1')?.type).toBe('application/vnd.oci.image.manifest.v1+json');
    expect(manifest.artifactType).toBe('application/vnd.loadweaver.vm-image.v1');
    expect(manifest.layers).toEqual([
      {
        mediaType: 'application/vnd.loadweaver.vm-image.disk.qcow2',
        digest: sha(disk),
        size: disk.length,
        annotations: { 'org.opencontainers.image.title': 'disk.qcow2' },
      },
    ]);
    expect(JSON.parse(blobs.get(manifest.config.digest)?.toString('utf8') ?? '{}')).toEqual({
      arch: 'amd64',
      format: 'qcow2',
      virtualSize: 20 * 1024 ** 3,
      firmware: ['uefi', 'bios'],
      guestAgent: true,
    });
    expect(blobs.get(sha(disk))).toEqual(disk);
    expect(reference).toBe(`registry.lw/shop/debian-13:1@${sha(manifests.get('shop/debian-13:1')?.body as Buffer)}`);
    expect(lines.at(-1)).toBe(`Pushed ${reference}`);
    expect(lines.some((l) => l.includes('uploading') && l.includes('(100%)'))).toBe(true);
    expect(requests.find((r) => r.method === 'PATCH')?.range).toBe(`0-${disk.length - 1}`);
    // Registry calls carry the registry token, never the CLI's own login.
    expect(requests.filter((r) => r.path.startsWith('/v2/')).every((r) => r.auth?.startsWith('Bearer ey'))).toBe(true);

    requests.length = 0;
    lines.length = 0;
    await pushVmImage(api(), { file, reference: 'shop/debian-13:2' }, (l) => lines.push(l), noQemu);
    expect(lines.some((l) => l.includes('already in the registry'))).toBe(true);
    expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(1); // only the (new) config blob
  });

  it('compresses raw disks with zstd and unpacks KubeVirt containerDisk archives', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lw-vm-raw-'));
    const raw = Buffer.alloc(64 * 1024, 0);

    raw.write('bootsector', 0);

    const archive = join(dir, 'containerdisk.tar.gz');

    await writeFile(archive, gzipSync(buildTar([{ name: 'disk/fedora.img', data: raw }])));

    const lines: string[] = [];

    await pushVmImage(
      api(),
      { file: archive, reference: 'shop/fedora:41', arch: 'arm64' },
      (l) => lines.push(l),
      noQemu,
    );

    const manifest = manifestOf('shop/fedora:41');
    const layer = manifest.layers[0];
    const createZstdDecompress = (zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }).zstdDecompressSync;

    expect(lines[0]).toBe('containerDisk: disk/fedora.img');
    expect(layer.mediaType).toBe('application/vnd.loadweaver.vm-image.disk.raw+zstd');
    expect(layer.annotations['org.opencontainers.image.title']).toBe('disk.raw.zst');
    expect(layer.size).toBeLessThan(raw.length);
    expect(createZstdDecompress?.(blobs.get(layer.digest) as Buffer)).toEqual(raw);
    expect(JSON.parse(blobs.get(manifest.config.digest)?.toString('utf8') ?? '{}')).toMatchObject({
      arch: 'arm64',
      format: 'raw',
      virtualSize: raw.length,
      firmware: ['uefi'],
    });
  });

  it('refuses early when the login may not push, and bios firmware on arm64', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lw-vm-refuse-'));
    const file = join(dir, 'a.qcow2');

    await writeFile(file, qcow2(1024 ** 3));
    pushAllowed = false;
    await expect(pushVmImage(api(), { file, reference: 'shop/a:1' }, () => undefined, noQemu)).rejects.toThrow(
      'may not push to registry.lw/shop/a',
    );
    pushAllowed = true;
    await expect(
      pushVmImage(api(), { file, reference: 'shop/a:1', arch: 'arm64', firmware: 'bios' }, () => undefined, noQemu),
    ).rejects.toThrow('bios firmware is amd64 only');
    expect(grantsPush('garbage', 'shop/a')).toBe(false);
  });
});
