import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { buildTar } from '@forepath/loadweaver/shared/util-release';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { pushBlob, pushManifest } from '../updates/registry-import';
import { redactUrl, validateVmImageImport, VmImageImportService } from './vm-image-import.service';

jest.mock('../updates/registry-import', () => ({
  pushBlob: jest.fn(async (_e: unknown, _r: string, _d: string, _s: number, body: unknown) => {
    if (body && typeof (body as AsyncIterable<Buffer>)[Symbol.asyncIterator] === 'function')
      for await (const _ of body as AsyncIterable<Buffer>) void _;
  }),
  pushManifest: jest.fn(async () => undefined),
}));

function qcow2(virtualSize: number, extra = 512): Buffer {
  const data = Buffer.alloc(512 + extra);

  data.writeUInt32BE(0x514649fb, 0);
  data.writeUInt32BE(3, 4);
  data.writeBigUInt64BE(BigInt(virtualSize), 24);

  return data;
}

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const sha512 = (data: Buffer) => createHash('sha512').update(data).digest('hex');

function service(role = 'operator') {
  const rows = new Map<string, Record<string, unknown>>();
  const audit = { record: jest.fn(async () => undefined) };
  const repo = {
    create: (v: Record<string, unknown>) => v,
    save: async (v: Record<string, unknown>) => {
      const row = { id: '11111111-1111-4111-8111-111111111111', createdAt: new Date(), ...v };

      rows.set(row.id as string, row);

      return row;
    },
    update: jest.fn(async ({ id }: { id: string }, patch: Record<string, unknown>) => {
      rows.set(id, { ...rows.get(id), ...patch });

      return { affected: 1 };
    }),
    exists: async () => true,
    find: async () => [{ controlPlane: true, overlayV4: '10.255.0.1', overlayV6: null }],
  };
  const manager = { getRepository: () => repo };
  const dataSource = {
    getRepository: () => repo,
    transaction: async (fn: (m: unknown) => Promise<unknown>) => await fn(manager),
  };
  const access = {
    caller: async () => ({ isApiKey: false, userId: 'u1', projects: new Map([['shop', role]]) }),
    assertRead: async () => undefined,
  };
  const tokens = { issue: jest.fn(async () => 'token') };
  const svc = new VmImageImportService(dataSource as never, access as never, audit as never, tokens as never);

  return { svc, rows, audit, tokens, repo };
}

describe('VM image imports (3.35)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-vm-import-spec-'));
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('validates requests: project ref, https, sha256, firmware', () => {
    const ok = { url: 'https://images.example.com/debian.qcow2', sha256: 'a'.repeat(64), ref: 'debian-13:1' };

    expect(validateVmImageImport('shop', ok)).toEqual({
      repository: 'debian-13',
      tag: '1',
      arch: 'amd64',
      firmware: ['uefi'],
      sha256: 'a'.repeat(64),
      sha512: null,
    });
    expect(() => validateVmImageImport('shop', { ...ok, url: 'http://images.example.com/x' })).toThrow(
      BadRequestException,
    );
    expect(() => validateVmImageImport('shop', { ...ok, sha256: 'xyz' })).toThrow(BadRequestException);
    expect(() => validateVmImageImport('shop', { ...ok, ref: 'registry.lw/other/x:1' })).toThrow(BadRequestException);
    expect(() => validateVmImageImport('shop', { ...ok, arch: 'arm64', firmware: ['bios'] })).toThrow(
      'bios firmware is amd64 only',
    );
    expect(redactUrl('https://user:pw@images.example.com/a.qcow2?token=x')).toBe('https://images.example.com/a.qcow2');
  });

  it('accepts a sha512 instead of the sha256, exactly one of them (3.42)', () => {
    const base = { url: 'https://images.example.com/debian.qcow2', ref: 'debian-13:1' };

    expect(validateVmImageImport('shop', { ...base, sha512: `sha512:${'F'.repeat(128)}` })).toMatchObject({
      sha256: null,
      sha512: 'f'.repeat(128),
    });
    expect(() => validateVmImageImport('shop', base)).toThrow('exactly one of sha256 and sha512');
    expect(() => validateVmImageImport('shop', { ...base, sha256: 'a'.repeat(64), sha512: 'f'.repeat(128) })).toThrow(
      'exactly one of sha256 and sha512',
    );
    expect(() => validateVmImageImport('shop', { ...base, sha512: 'a'.repeat(64) })).toThrow(
      'sha512 must be the hex SHA-512',
    );
    expect(() => validateVmImageImport('shop', { ...base, sha256: `sha512:${'a'.repeat(64)}` })).toThrow(
      BadRequestException,
    );
  });

  it('queues imports for operators only, audited', async () => {
    const { svc, audit } = service();
    const dto = await svc.create(undefined, 'shop', {
      url: 'https://images.example.com/debian.qcow2?sig=secret',
      sha256: `sha256:${'A'.repeat(64)}`,
      ref: 'debian-13:1',
    });

    expect(dto).toMatchObject({
      status: 'pending',
      sha256: 'a'.repeat(64),
      sha512: null,
      url: 'https://images.example.com/debian.qcow2',
      reference: 'registry.lw/shop/debian-13:1',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'vm-image.import' }),
    );
    await expect(
      service('developer').svc.create(undefined, 'shop', {
        url: 'https://x.example.com/a',
        sha256: 'a'.repeat(64),
        ref: 'a:1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const debian = await svc.create(undefined, 'shop', {
      url: 'https://cloud.debian.org/images/cloud/trixie/x/debian-13-genericcloud-amd64-x.qcow2',
      sha512: 'e'.repeat(128),
      ref: 'debian:13',
    });

    expect(debian).toMatchObject({ sha256: null, sha512: 'e'.repeat(128) });
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ details: expect.objectContaining({ sha512: 'e'.repeat(128) }) }),
    );
  });

  it('unpacks gzip-compressed KubeVirt containerDisk tars to their qcow2', async () => {
    const { svc } = service();
    const disk = qcow2(8 * 1024 ** 3);
    const path = join(dir, 'download');

    await writeFile(
      path,
      gzipSync(
        buildTar([
          { name: 'README', data: 'hi' },
          { name: 'disk/fedora.qcow2', data: disk },
        ]),
      ),
    );

    const result = await svc.unpack(path, dir);

    expect(result).toMatchObject({ format: 'qcow2', virtualSize: 8 * 1024 ** 3, containerDisk: true });
    expect(await readFile(result.path)).toEqual(disk);

    await writeFile(path, buildTar([{ name: 'etc/hosts', data: 'x' }]));
    await expect(svc.unpack(path, dir)).rejects.toThrow('not a KubeVirt containerDisk');
    await writeFile(path, Buffer.alloc(4096, 1));
    await expect(svc.unpack(path, dir)).resolves.toMatchObject({ format: 'raw', virtualSize: 4096 });
  });

  it('downloads with an SSRF check per redirect hop, verifies the sha256 and pushes the artifact', async () => {
    const { svc, rows, tokens } = service();
    const disk = qcow2(1024 ** 3);
    const validated: string[] = [];

    svc.validateUrl = async (url: string) => void validated.push(url);
    svc.fetchImpl = async (url: string) =>
      url.endsWith('/start')
        ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/disk.qcow2' } })
        : new Response(new Uint8Array(disk), { status: 200, headers: { 'content-length': String(disk.length) } });

    const row = {
      id: '22222222-2222-4222-8222-222222222222',
      project: 'shop',
      repository: 'debian',
      tag: '13',
      url: 'https://images.example.com/start',
      sha256: sha(disk),
      arch: 'amd64',
      firmware: ['uefi'],
      guestAgent: true,
      worker: null,
    };

    rows.set(row.id, row);
    await svc.run(row as never);

    expect(validated).toEqual(['https://images.example.com/start', 'https://cdn.example.com/disk.qcow2']);
    expect(rows.get(row.id)).toMatchObject({ status: 'succeeded', format: 'qcow2', virtualSize: String(1024 ** 3) });
    expect(tokens.issue).toHaveBeenCalledWith(
      'control-plane:vm-images',
      [{ name: 'shop/debian', actions: ['pull', 'push'] }],
      3600,
    );
    expect(pushBlob).toHaveBeenCalledTimes(2);
    expect(pushManifest).toHaveBeenCalledWith(
      expect.objectContaining({ host: '10.255.0.1', token: 'token' }),
      'shop/debian',
      '13',
      'application/vnd.oci.image.manifest.v1+json',
      expect.any(Buffer),
    );

    const manifest = JSON.parse((pushManifest as jest.Mock).mock.calls[0][4].toString('utf8'));

    expect(manifest.layers[0]).toMatchObject({
      mediaType: 'application/vnd.loadweaver.vm-image.disk.qcow2',
      size: disk.length,
    });
    expect(rows.get(row.id)?.['digest']).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('fails a download that stalls instead of running on with no progress (G5)', async () => {
    const { svc, rows } = service();
    const row = {
      id: '44444444-4444-4444-8444-444444444444',
      project: 'shop',
      repository: 'debian',
      tag: '13',
      url: 'https://images.example.com/slow',
      sha256: 'c'.repeat(64),
      arch: 'amd64',
      firmware: ['uefi'],
      guestAgent: false,
      worker: null,
    };

    svc.stallMs = 100;
    svc.validateUrl = async () => undefined;
    svc.fetchImpl = async (_url: string, init?: RequestInit) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(1024));
            // …and then nothing: only the abort ends it.
            init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
          },
        }),
        { status: 200 },
      );
    rows.set(row.id, row);
    await svc.run(row as never);
    expect(rows.get(row.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('download stalled: no progress for 0 s (receiving)'),
    });

    // A hang in the per-hop address check (no signal there) ends the same way, named.
    svc.validateUrl = () => new Promise(() => undefined);
    await svc.run(row as never);
    expect(rows.get(row.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('(checking the address of images.example.com)'),
    });
  });

  it('runs the import it claimed: TypeORM answers UPDATE … RETURNING with [rows, affected] (G5)', async () => {
    const { svc, rows } = service();
    const id = '55555555-5555-4555-8555-555555555555';
    const run = jest.spyOn(svc, 'run').mockResolvedValue(undefined);
    const ds = (svc as unknown as { dataSource: Record<string, unknown> }).dataSource;

    rows.set(id, { id, project: 'shop', repository: 'debian', tag: '13' });
    jest.spyOn(svc as unknown as { registryReady(): Promise<boolean> }, 'registryReady').mockResolvedValue(true);
    ds['query'] = jest.fn(async () => [[{ id }], 1]);
    ds['getRepository'] = () => ({ findOneOrFail: async () => rows.get(id) });
    expect(await svc.tick()).toBe(id);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id }));

    // Nothing due: [[], 0].
    run.mockClear();
    ds['query'] = jest.fn(async () => [[], 0]);
    expect(await svc.tick()).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('leaves imports queued while no registry can take pushes (no member node / object store yet)', async () => {
    const { svc } = service();
    const run = jest.spyOn(svc, 'run').mockResolvedValue(undefined);
    const query = jest.fn(async () => [] as unknown[]);

    (svc as unknown as { dataSource: { query: typeof query } }).dataSource.query = query;
    expect(await svc.tick()).toBeNull();
    // Only the readiness check ran: nothing was claimed, nothing downloaded.
    expect(query).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it('logs what a busy worker waits on instead of leaving due imports silently pending (G5)', async () => {
    const { svc } = service();
    const warn = jest.spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');
    let release: (rows: unknown[]) => void = () => undefined;
    const query = jest.fn(() => new Promise<unknown[]>((resolve) => (release = resolve)));

    (svc as unknown as { dataSource: { query: typeof query } }).dataSource.query = query;
    jest.spyOn(svc as unknown as { registryReady(): Promise<boolean> }, 'registryReady').mockResolvedValue(true);

    const first = svc.safeTick();
    const start = Date.now();

    await svc.safeTick(start + 60_000);
    expect(warn).not.toHaveBeenCalled();
    await svc.safeTick(start + 6 * 60_000);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/worker busy with claiming the next import for \d+ s/));
    // At most one line per 5 min.
    await svc.safeTick(start + 7 * 60_000);
    expect(warn).toHaveBeenCalledTimes(1);
    release([]);
    await first;
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails on a sha256 mismatch and on refused hops', async () => {
    const { svc, rows } = service();
    const row = {
      id: '33333333-3333-4333-8333-333333333333',
      project: 'shop',
      repository: 'debian',
      tag: '13',
      url: 'https://images.example.com/disk',
      sha256: 'b'.repeat(64),
      arch: 'amd64',
      firmware: ['uefi'],
      guestAgent: false,
      worker: null,
    };

    svc.validateUrl = async () => undefined;
    svc.fetchImpl = async () => new Response(new Uint8Array(qcow2(1024)), { status: 200 });
    rows.set(row.id, row);
    await svc.run(row as never);
    expect(rows.get(row.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('sha256 mismatch') });

    // A sha512 import is verified against the SHA-512 of the download (3.42).
    const disk = qcow2(1024);
    const bySha512 = { ...row, sha256: null, sha512: sha512(disk) };

    svc.fetchImpl = async () => new Response(new Uint8Array(disk), { status: 200 });
    await svc.run(bySha512 as never);
    expect(rows.get(row.id)).toMatchObject({ status: 'succeeded' });
    await svc.run({ ...bySha512, sha512: 'd'.repeat(128) } as never);
    expect(rows.get(row.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('sha512 mismatch') });
    (pushManifest as jest.Mock).mockClear();

    svc.validateUrl = async (url: string) => {
      if (url.includes('169.254')) throw new Error('private address');
    };
    svc.fetchImpl = async () => new Response(null, { status: 301, headers: { location: 'https://169.254.169.254/' } });
    await svc.run(row as never);
    expect(rows.get(row.id)).toMatchObject({ status: 'failed', error: 'private address' });
    expect(pushManifest).not.toHaveBeenCalled();
  });
});
