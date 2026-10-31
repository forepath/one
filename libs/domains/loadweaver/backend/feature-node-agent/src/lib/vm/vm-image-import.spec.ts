import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import * as zlib from 'node:zlib';

import type { VolumeAssignment } from '@forepath/loadweaver/shared/util-agent-protocol';

import type { JobContainerSpec, JobOutput } from '../backups/backup-jobs';
import { WorkloadDeferred } from '../workloads/workload.manager';
import { BootDiskImports, type BootDiskImportEvent } from './boot-disk-imports';
import {
  blobEncoding,
  cacheMarkerPath,
  cachedDiskPath,
  checkImageInfo,
  convertProgress,
  importingTag,
  initMarker,
  initTag,
  isQcow2,
  isTarHeader,
  VmImageImporter,
  writeDiskFile,
} from './vm-image-import';

const MIB = 1024 ** 2;
const sha = (data: Buffer) => `sha256:${createHash('sha256').update(data).digest('hex')}`;
const zstd = (data: Buffer) => (zlib as unknown as { zstdCompressSync: (b: Buffer) => Buffer }).zstdCompressSync(data);
const chunks = (data: Buffer, size = 64 * 1024) =>
  Readable.from(
    Array.from({ length: Math.ceil(data.length / size) }, (_, i) => data.subarray(i * size, (i + 1) * size)),
  );

/** A qcow2-looking file (magic + payload; `qemu-img` itself is mocked). */
const qcow2 = (bytes = 3 * MIB) => {
  const data = Buffer.alloc(bytes, 7);

  data.writeUInt32BE(0x514649fb, 0);

  return data;
};

/** A minimal ustar archive (directories and regular files). */
function tar(entries: { name: string; data?: Buffer; dir?: boolean }[]): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const header = Buffer.alloc(512);
    const data = entry.data ?? Buffer.alloc(0);

    header.write(entry.name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 'latin1');
    header.write('0000000\0', 108, 'latin1');
    header.write('0000000\0', 116, 'latin1');
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
    header.write('00000000000\0', 136, 'latin1');
    header.write('        ', 148, 'latin1');
    header.write(entry.dir ? '5' : '0', 156, 'latin1');
    header.write('ustar\0', 257, 'latin1');
    header.write('00', 263, 'latin1');

    let sum = 0;

    for (const b of header) sum += b;

    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }

  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

describe('VM image import (M7.3)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-vmimg-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('content detection', () => {
    it('recognises compression, qcow2 and tar headers', () => {
      expect(blobEncoding(zlib.gzipSync(Buffer.from('x')))).toBe('gzip');
      expect(blobEncoding(zstd(Buffer.from('x')))).toBe('zstd');
      expect(blobEncoding(Buffer.from('QFI\xfb', 'latin1'))).toBe('none');
      expect(isQcow2(qcow2(16))).toBe(true);
      expect(isQcow2(Buffer.from('\x00\x00\x00\x00'))).toBe(false);
      expect(isTarHeader(tar([{ name: 'disk/', dir: true }]))).toBe(true);

      const broken = tar([{ name: 'disk/', dir: true }]);

      broken[0] ^= 1;
      expect(isTarHeader(broken)).toBe(false);
    });

    it('reads the initialization marker from LV tags', () => {
      expect(initMarker(['other', initTag('sha256:aa')])).toEqual({ initialized: 'sha256:aa' });
      expect(initMarker([importingTag('sha256:bb')])).toEqual({ importing: 'sha256:bb' });
      expect(initMarker([])).toEqual({});
    });
  });

  describe('writeDiskFile', () => {
    it('stores a qcow2 layer as is after verifying its digest', async () => {
      const blob = qcow2();
      const target = join(dir, 'disk');

      expect(
        await writeDiskFile(chunks(blob), target, { digest: sha(blob), format: 'qcow2', maxBytes: 10 * MIB }),
      ).toEqual({ format: 'qcow2', bytes: blob.length });
      expect((await readFile(target)).equals(blob)).toBe(true);
    });

    it('decompresses a raw+zstd layer into a sparse file (empty space stays a hole)', async () => {
      const raw = Buffer.alloc(64 * MIB);

      raw.write('boot sector', 0);
      raw.write('the end', raw.length - 16);

      const blob = zstd(raw);
      const target = join(dir, 'disk');
      const result = await writeDiskFile(chunks(blob), target, {
        digest: sha(blob),
        format: 'raw',
        maxBytes: 64 * MIB,
      });

      expect(result).toEqual({ format: 'raw', bytes: 64 * MIB });
      expect((await readFile(target)).equals(raw)).toBe(true);
      // 62 of the 64 MiB were zero blocks: written as holes (tmpfs and disk file systems both support them).
      expect((await stat(target)).blocks * 512).toBeLessThan(8 * MIB);
    }, 30_000); // 64 MiB of zstd on a shared CI runner can take longer than the 5 s default.

    it('extracts the disk of a KubeVirt containerDisk (gzip tar with /disk/*.qcow2)', async () => {
      const disk = qcow2(2 * MIB);
      const blob = zlib.gzipSync(
        tar([
          { name: 'disk/', dir: true },
          { name: 'README', data: Buffer.from('hello') },
          { name: 'disk/fedora.qcow2', data: disk },
        ]),
      );
      const target = join(dir, 'disk');

      expect(
        await writeDiskFile(chunks(blob), target, { digest: sha(blob), format: 'qcow2', maxBytes: 10 * MIB }),
      ).toEqual({ format: 'qcow2', bytes: disk.length });
      expect((await readFile(target)).equals(disk)).toBe(true);
    });

    it('takes a containerDisk .img as raw', async () => {
      const disk = Buffer.alloc(MIB, 1);
      const blob = tar([{ name: './disk/os.img', data: disk }]);

      expect(
        await writeDiskFile(chunks(blob), join(dir, 'disk'), { digest: sha(blob), format: 'qcow2', maxBytes: 4 * MIB }),
      ).toEqual({ format: 'raw', bytes: MIB });
    });

    it('removes the file on a digest mismatch, a foreign layer or a disk larger than allowed', async () => {
      const blob = qcow2();
      const target = join(dir, 'disk');

      await expect(
        writeDiskFile(chunks(blob), target, { digest: sha(Buffer.from('x')), format: 'qcow2', maxBytes: 10 * MIB }),
      ).rejects.toThrow('digest mismatch');
      await expect(stat(target)).rejects.toThrow();

      const text = Buffer.from('not a disk at all');

      await expect(
        writeDiskFile(chunks(text), target, { digest: sha(text), format: 'qcow2', maxBytes: 10 * MIB }),
      ).rejects.toThrow('no qcow2 disk');

      const noDisk = tar([{ name: 'etc/passwd', data: Buffer.from('root') }]);

      await expect(
        writeDiskFile(chunks(noDisk), target, { digest: sha(noDisk), format: 'qcow2', maxBytes: 10 * MIB }),
      ).rejects.toThrow('no containerDisk');

      const raw = zstd(Buffer.alloc(8 * MIB, 1));

      await expect(
        writeDiskFile(chunks(raw), target, { digest: sha(raw), format: 'raw', maxBytes: 4 * MIB }),
      ).rejects.toThrow('larger than its disk');
      await expect(stat(target)).rejects.toThrow();
    });
  });

  describe('checkImageInfo', () => {
    const info = (extra: Record<string, unknown> = {}) =>
      JSON.stringify({ format: 'qcow2', 'virtual-size': 10 * MIB, ...extra });

    it('accepts a self-contained image that fits the disk', () => {
      expect(checkImageInfo(info(), 'qcow2', 10 * MIB)['virtual-size']).toBe(10 * MIB);
    });

    it('refuses other formats, backing / data files and images larger than the disk', () => {
      expect(() => checkImageInfo(info({ format: 'raw' }), 'qcow2', 10 * MIB)).toThrow('not qcow2');
      expect(() => checkImageInfo(info({ 'backing-filename': '/etc/shadow' }), 'qcow2', 10 * MIB)).toThrow(
        'backing file',
      );
      expect(() =>
        checkImageInfo(info({ 'format-specific': { type: 'qcow2', data: { 'data-file': 'x' } } }), 'qcow2', 10 * MIB),
      ).toThrow('external data file');
      expect(() => checkImageInfo(info(), 'qcow2', 5 * MIB)).toThrow('exceeds the disk');
      expect(() => checkImageInfo('oops', 'qcow2', 5 * MIB)).toThrow('no JSON');
    });
  });

  describe('VmImageImporter', () => {
    const blob = qcow2();
    const digest = sha(blob);
    const volume: VolumeAssignment = {
      id: 'shop/lw-vm/db1.root',
      dockerName: 'lw-vol-shop.lw-vm.db1.root',
      minor: 1003,
      port: 7803,
      sizeBytes: 20 * MIB,
      replicas: [
        { node: 'n1', nodeId: 0, address: '10.93.0.1' },
        { node: 'n2', nodeId: 1, address: '10.93.0.2' },
      ],
      connections: [{ a: 'n1', b: 'n2', protocol: 'C' }],
      primary: 'n1',
      keyRef: 'secret://shop/lw-volume-lw-vm.db1.root',
      mode: 'block',
      initializeFrom: { digest, format: 'qcow2' },
    };
    const image = {
      ref: `registry.lw.internal/shop/debian@sha256:${'1'.repeat(64)}`,
      digest: `sha256:${'1'.repeat(64)}`,
      format: 'qcow2' as const,
      layerDigest: digest,
    };
    const LAUNCHER = 'ghcr.io/forepath/microvm-launcher:1.0.0';

    function setup(
      options: {
        tags?: string[];
        fresh?: boolean;
        jobs?: Record<string, JobOutput>;
        /** Shared LV tags (agent restarts keep the disk's tags). */
        store?: { tags: string[] };
        run?: (spec: JobContainerSpec) => Promise<JobOutput>;
      } = {},
    ) {
      const store = options.store ?? { tags: [...(options.tags ?? [])] };
      const calls: string[] = [];
      const volumes = {
        assignment: jest.fn(() => volume),
        lvTags: jest.fn(async () => [...store.tags]),
        setLvTags: jest.fn(async (_id: string, add: string[], remove: string[] = []) => {
          calls.push(`tags +${add.join(',')} -${remove.join(',')}`);
          store.tags = [...store.tags.filter((t) => !remove.includes(t)), ...add];
        }),
        promoteBlock: jest.fn(async () => (calls.push('promote'), { device: '/dev/drbd1003', fresh: !!options.fresh })),
        demoteBlock: jest.fn(async () => void calls.push('demote')),
        blockSizeBytes: jest.fn(async () => 20 * MIB),
      };
      const specs: JobContainerSpec[] = [];
      const jobs = {
        run: jest.fn(async (spec: JobContainerSpec) => {
          specs.push(spec);
          calls.push(`qemu-img ${spec.cmd[0]}`);

          if (options.run) return await options.run(spec);

          return (
            options.jobs?.[spec.cmd[0]] ?? {
              exitCode: 0,
              stdout: spec.cmd[0] === 'info' ? JSON.stringify({ format: 'qcow2', 'virtual-size': 8 * MIB }) : '',
              stderr: '',
              combined: '',
            }
          );
        }),
      };
      const router = {
        registryClient: { routerPort: 5050 },
        withRepository: jest.fn(async (repository: string, task: () => Promise<unknown>) => {
          calls.push(`borrow ${repository}`);

          return await task();
        }),
      };
      const source = { open: jest.fn(async () => (calls.push('fetch'), chunks(blob))) };
      const importer = new VmImageImporter(volumes as never, jobs as never, router as never, source as never, {
        root: join(dir, 'cache'),
        maxBytes: 100 * MIB,
      });

      return { importer, volumes, jobs, specs, source, router, calls, tags: () => store.tags };
    }

    it('writes the image onto a fresh boot disk: marked, verified by qemu-img info, converted, marked done', async () => {
      const { importer, specs, source, calls, tags } = setup({ fresh: true });

      expect(await importer.ensureInitialized(volume.id, image, LAUNCHER)).toBe('/dev/drbd1003');
      expect(calls).toEqual([
        'promote',
        `tags +${importingTag(digest)} -`,
        `tags +${importingTag(digest)} -${importingTag(digest)}`,
        'fetch',
        'qemu-img info',
        'qemu-img convert',
        `tags +${initTag(digest)} -${importingTag(digest)}`,
      ]);
      expect(tags()).toEqual([initTag(digest)]);
      expect(source.open).toHaveBeenCalledWith(image.ref, digest, { routerPort: 5050 });

      const blobPath = cachedDiskPath({ root: join(dir, 'cache') }, digest);

      for (const spec of specs) {
        // Import mode: launcher image, no network, no capabilities, read-only root, only the disk device, blob ro.
        expect(spec).toMatchObject({
          image: LAUNCHER,
          entrypoint: ['/usr/bin/qemu-img'],
          network: 'none',
          capAdd: [],
          readOnly: true,
          user: '0:0',
          devices: [{ path: '/dev/drbd1003', permissions: 'rw' }],
          binds: [`${blobPath}:/import/disk:ro`],
        });
      }

      expect(specs[0].cmd).toEqual(['info', '--output=json', '-f', 'qcow2', '/import/disk']);
      expect(specs[1].cmd).toEqual([
        'convert',
        '-p',
        '-n',
        '-f',
        'qcow2',
        '-O',
        'raw',
        '-t',
        'none',
        '/import/disk',
        '/dev/drbd1003',
      ]);
      expect((await readFile(blobPath)).equals(blob)).toBe(true);
      expect(JSON.parse(await readFile(cacheMarkerPath({ root: join(dir, 'cache') }, digest), 'utf8'))).toMatchObject({
        digest,
        format: 'qcow2',
        bytes: blob.length,
      });
    });

    it('never imports onto a disk that is initialized or holds data (failover: adopted), repeats an interrupted one', async () => {
      const done = setup({ tags: [initTag(digest)] });

      await done.importer.ensureInitialized(volume.id, image, LAUNCHER);
      expect(done.calls).toEqual(['promote']);

      // Another image pinned since: the disk keeps its data (re-imaging is explicit).
      const repinned = setup({ tags: [initTag(`sha256:${'9'.repeat(64)}`)] });

      await repinned.importer.ensureInitialized(volume.id, image, LAUNCHER);
      expect(repinned.calls).toEqual(['promote']);

      const failover = setup({ fresh: false });

      await failover.importer.ensureInitialized(volume.id, image, LAUNCHER);
      expect(failover.calls).toEqual(['promote', `tags +${initTag(digest)} -`]);
      expect(failover.jobs.run).not.toHaveBeenCalled();

      const interrupted = setup({ fresh: false, tags: [importingTag(digest)] });

      await interrupted.importer.ensureInitialized(volume.id, image, LAUNCHER);
      expect(interrupted.calls).toContain('qemu-img convert');
      expect(interrupted.tags()).toEqual([initTag(digest)]);
    });

    it('keeps the importing mark when qemu-img refuses the image or fails, and reuses the cached blob', async () => {
      const refused = setup({
        fresh: true,
        jobs: {
          info: {
            exitCode: 0,
            stdout: JSON.stringify({ format: 'qcow2', 'virtual-size': 8 * MIB, 'backing-filename': 'x' }),
            stderr: '',
            combined: '',
          },
        },
      });

      await expect(refused.importer.ensureInitialized(volume.id, image, LAUNCHER)).rejects.toThrow('backing file');
      expect(refused.calls).not.toContain('qemu-img convert');
      expect(refused.tags()).toEqual([importingTag(digest)]);

      const failing = setup({
        tags: [importingTag(digest)],
        jobs: { convert: { exitCode: 1, stdout: '', stderr: 'write error', combined: 'write error' } },
      });

      await expect(failing.importer.ensureInitialized(volume.id, image, LAUNCHER)).rejects.toThrow(
        'qemu-img convert failed (exit 1): write error',
      );
      // Cached by the first run: no second download.
      expect(failing.source.open).not.toHaveBeenCalled();
      expect(failing.tags()).toEqual([importingTag(digest)]);
    });

    it('reports progress (download bytes, then qemu-img -p of the virtual size) and stops on cancellation', async () => {
      const steps: unknown[] = [];
      const { importer, specs } = setup({
        fresh: true,
        run: async (spec) => {
          if (spec.cmd[0] === 'convert') spec.progress?.stdout('    (0.00/100%)\r    (25.00/100%)\r');

          return {
            exitCode: 0,
            stdout: spec.cmd[0] === 'info' ? JSON.stringify({ format: 'qcow2', 'virtual-size': 8 * MIB }) : '',
            stderr: '',
            combined: '',
          };
        },
      });
      const prepared = await importer.prepareBootDisk(volume.id);

      expect(prepared).toEqual({ device: '/dev/drbd1003', import: { digest, format: 'qcow2' } });
      await importer.importBootDisk(volume.id, prepared.device, { ref: image.ref, digest, format: 'qcow2' }, LAUNCHER, {
        progress: (step) => steps.push(step),
      });
      expect(steps[0]).toEqual({ phase: 'fetching', bytes: 0 });
      expect(steps).toContainEqual({ phase: 'fetching', bytes: blob.length });
      expect(steps.slice(-3)).toEqual([
        { phase: 'writing', bytes: 0, totalBytes: 8 * MIB },
        { phase: 'writing', bytes: 2 * MIB, totalBytes: 8 * MIB },
        { phase: 'writing', bytes: 8 * MIB, totalBytes: 8 * MIB },
      ]);
      expect(specs[1].progress?.intervalMs).toBeGreaterThan(0);
      expect(convertProgress('')).toBeNull();
      expect(convertProgress('(100.00/100%)')).toBe(1);

      // Cancelled before / while writing: the job's signal reaches the container run; the import rejects.
      const controller = new AbortController();
      const cancelled = setup({
        fresh: true,
        run: async (spec) => {
          expect(spec.signal).toBe(controller.signal);
          controller.abort(new Error('cancelled: gone'));
          throw spec.signal?.reason as Error;
        },
      });
      const again = await cancelled.importer.prepareBootDisk(volume.id);

      await expect(
        cancelled.importer.importBootDisk(
          volume.id,
          again.device,
          { ref: image.ref, digest, format: 'qcow2' },
          LAUNCHER,
          {
            signal: controller.signal,
          },
        ),
      ).rejects.toThrow('cancelled: gone');
      // Still marked as importing: the next attempt here repeats it.
      expect(cancelled.tags()).toEqual([importingTag(digest)]);
    });

    it('repeats an import interrupted by an agent restart (marked before it was queued), never one that finished', async () => {
      const store = { tags: [] as string[] };
      const hang = new Promise<JobOutput>(() => undefined);
      // First agent process: the disk is promoted fresh, marked, its write hangs (then the agent dies).
      const first = setup({ fresh: true, store, run: () => hang });
      const events: BootDiskImportEvent[] = [];
      const jobsA = new BootDiskImports(first.importer, first.volumes as never, (e) => events.push(e), {
        concurrency: 1,
      });

      await expect(
        jobsA.ensure({ replica: 'shop/lw-vm/db1/0', specHash: 'h' }, volume.id, image, LAUNCHER),
      ).rejects.toBeInstanceOf(WorkloadDeferred);
      expect(store.tags).toEqual([importingTag(digest)]);

      // Second process: DRBD no longer says fresh (the disk was promoted before), the mark says "repeat".
      const second = setup({ fresh: false, store });
      const jobsB = new BootDiskImports(second.importer, second.volumes as never, () => undefined, { concurrency: 1 });
      const settled = new Promise<void>((resolve) => jobsB.onSettled(resolve));

      await expect(
        jobsB.ensure({ replica: 'shop/lw-vm/db1/0', specHash: 'h' }, volume.id, image, LAUNCHER),
      ).rejects.toBeInstanceOf(WorkloadDeferred);
      await settled;
      expect(second.calls).toContain('qemu-img convert');
      expect(store.tags).toEqual([initTag(digest)]);

      // Third process: finished → handed out without any write.
      const third = setup({ fresh: false, store });
      const jobsC = new BootDiskImports(third.importer, third.volumes as never, () => undefined);

      expect(await jobsC.ensure({ replica: 'shop/lw-vm/db1/0', specHash: 'h' }, volume.id, image, LAUNCHER)).toBe(
        '/dev/drbd1003',
      );
      expect(third.jobs.run).not.toHaveBeenCalled();
      expect(third.calls).toEqual(['promote']);
    });

    it('re-images a stopped VM through a borrowed repository and demotes the disk afterwards', async () => {
      const { importer, calls, tags } = setup({ tags: [initTag(`sha256:${'9'.repeat(64)}`)] });

      await importer.reimage(volume.id, image, LAUNCHER);

      expect(calls).toEqual([
        'promote',
        'borrow shop/debian',
        `tags +${importingTag(digest)} -${initTag(`sha256:${'9'.repeat(64)}`)}`,
        'fetch',
        'qemu-img info',
        'qemu-img convert',
        `tags +${initTag(digest)} -${importingTag(digest)}`,
        'demote',
      ]);
      expect(tags()).toEqual([initTag(digest)]);
    });

    it('collects least recently used cache entries over the cap, keeping wanted ones and fetches in flight', async () => {
      const root = join(dir, 'cache');
      const importer = new VmImageImporter({} as never, {} as never, undefined, {} as never, {
        root,
        maxBytes: 3 * MIB,
      });

      await mkdir(join(root, 'sha256'), { recursive: true });
      await mkdir(join(root, 'staging'), { recursive: true });
      await writeFile(join(root, 'staging', `${'f'.repeat(64)}.abcd`), 'partial');

      const digests = ['a', 'b', 'c'].map((c) => `sha256:${c.repeat(64)}`);

      for (const [i, d] of digests.entries()) {
        await writeFile(cachedDiskPath({ root }, d), Buffer.alloc(2 * MIB, 1));
        await writeFile(
          cacheMarkerPath({ root }, d),
          JSON.stringify({ digest: d, format: 'qcow2', bytes: 2 * MIB, usedAt: i }),
        );
      }

      expect(await importer.gc(new Set([digests[0]]))).toEqual([digests[1], digests[2]]);
      expect((await readdir(join(root, 'sha256'))).sort()).toEqual([`${'a'.repeat(64)}`, `${'a'.repeat(64)}.json`]);
      expect(await readdir(join(root, 'staging'))).toEqual([]);
    });
  });
});
