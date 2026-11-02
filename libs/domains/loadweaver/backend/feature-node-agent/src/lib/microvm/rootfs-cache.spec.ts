import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import {
  bearerTokenUrl,
  guestLayers,
  layerDir,
  layerMarker,
  layersToCollect,
  mountedLayers,
  nodeArchitecture,
  overlayMountOptions,
  RegistryBlobSource,
  replicaKey,
  replicaPaths,
  RootfsCache,
  type LayerUnpacker,
  type MicrovmLayer,
  type VmrootConfig,
} from './rootfs-cache';

const hex = (c: string) => c.repeat(64);
const layer = (c: string, d = c): MicrovmLayer => ({
  digest: `sha256:${hex(c)}`,
  diffId: `sha256:${hex(d)}`,
  size: 1000,
  mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
});
const registry = {
  privateHost: 'registry.lw.internal',
  privatePort: 5000,
  routerPort: 5005,
  mirrors: [{ host: 'docker.io', port: 5001 }],
} as never;

function commandsMock(thinPool: boolean) {
  const lvs: string[] = thinPool ? ['pool'] : [];

  return {
    calls: [] as string[],
    run: jest.fn(async function (this: unknown, command: string, args: string[]) {
      if (command === 'lvcreate') lvs.push(args[args.length - 1]);

      return { stdout: '', stderr: '' };
    }),
    json: jest.fn(async () => ({ report: [{ lv: lvs.map((lv_name) => ({ lv_name })) }] })),
    available: jest.fn(async () => true),
  };
}

describe('rootfs cache (3.35)', () => {
  let dir: string;
  let config: VmrootConfig;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-vmroot-'));
    config = { root: join(dir, 'vmroot'), mountRoot: join(dir, 'run', 'vmroot'), layerMaxBytes: 1024 ** 3 };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lays out layers by diffID and replicas by a hash of the workload id', () => {
    expect(layerDir(config, `sha256:${hex('a')}`)).toBe(join(config.root, 'layers', 'sha256', hex('a')));
    expect(layerMarker(config, `sha256:${hex('a')}`)).toBe(`${join(config.root, 'layers', 'sha256', hex('a'))}.json`);
    expect(() => layerDir(config, 'sha256:../../etc')).toThrow(/invalid layer digest/);
    expect(replicaKey('shop/web/app/0')).toMatch(/^[0-9a-f]{24}$/);

    const paths = replicaPaths(config, 'shop/web/app/0');

    expect(paths).toMatchObject({
      dir: join(config.root, 'replicas', paths.key),
      upper: join(config.root, 'replicas', paths.key, 'rw', 'upper'),
      // The overlay lives on tmpfs: after a reboot Docker finds no bind source instead of an empty guest root.
      merged: join(config.mountRoot, paths.key, 'merged'),
      lv: `lw-vmrw-${paths.key}`,
    });
  });

  it('stacks the layers top first and mounts nosuid,nodev,noexec without index / redirects / metacopy', () => {
    const options = overlayMountOptions(config, [layer('a'), layer('b')], { upper: '/u', work: '/w' });

    expect(options).toBe(
      `lowerdir=${layerDir(config, `sha256:${hex('b')}`)}:${layerDir(config, `sha256:${hex('a')}`)},upperdir=/u,workdir=/w,nosuid,nodev,noexec,index=off,redirect_dir=off,metacopy=off`,
    );
    expect(() => overlayMountOptions(config, [], { upper: '/u', work: '/w' })).toThrow(/at least one layer/);
    expect(() =>
      overlayMountOptions(
        config,
        Array.from({ length: 60 }, (_, i) => layer('a', (i % 16).toString(16))),
        { upper: '/u', work: '/w' },
      ),
    ).toThrow(/E_MICROVM_IMAGE_UNSUPPORTED/);
  });

  it("picks the node's architecture from multi-arch guest images and refuses a missing one", () => {
    expect(nodeArchitecture('x64')).toBe('amd64');
    expect(nodeArchitecture('arm64')).toBe('arm64');
    expect(nodeArchitecture('s390x')).toBeNull();

    const multi = { platformLayers: { amd64: [layer('a')], arm64: [layer('b')] }, layers: [layer('c')] };

    expect(guestLayers(multi, 'arm64')).toEqual([layer('b')]);
    expect(guestLayers(multi, 'amd64')).toEqual([layer('a')]);
    expect(() => guestLayers({ platformLayers: { amd64: [layer('a')] } }, 'arm64')).toThrow(
      /E_MICROVM_IMAGE_UNSUPPORTED: the guest image has no arm64 variant \(available: amd64\)/,
    );
    // Single-architecture images (the plan pinned one platform).
    expect(guestLayers({ layers: [layer('c')] }, 'arm64')).toEqual([layer('c')]);
  });

  it('collects unreferenced layers, least recently used first, until the cache fits', () => {
    const layers = [
      { hex: 'a', bytes: 100, usedAt: 3 },
      { hex: 'b', bytes: 100, usedAt: 1 },
      { hex: 'c', bytes: 100, usedAt: 2 },
      { hex: 'd', bytes: 100, usedAt: 0 },
    ];

    expect(layersToCollect(layers, new Set(['d']), 200)).toEqual(['b', 'c']);
    expect(layersToCollect(layers, new Set(), 1000)).toEqual([]);
    expect(layersToCollect(layers, new Set(['a', 'b', 'c', 'd']), 0)).toEqual([]);
  });

  it('finds the layers mounted overlays use', () => {
    const prefix = join(config.root, 'layers', 'sha256');
    const mountinfo = [
      `80 25 0:50 / /run/loadweaver/vmroot/k/merged rw,nosuid,nodev,noexec - overlay overlay rw,lowerdir=${prefix}/${hex('a')}:${prefix}/${hex('b')},upperdir=/x/upper,workdir=/x/work`,
      '81 25 0:51 / /var/lib/docker/overlay2/x/merged rw - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/ABC,upperdir=/u',
    ].join('\n');

    expect([...mountedLayers(mountinfo, config.root)]).toEqual([hex('a'), hex('b')]);
  });

  it('fetches blobs through the node router for cluster images and anonymously from public registries', async () => {
    const source = new RegistryBlobSource();
    const digest = `sha256:${hex('a')}`;

    expect(source.blobUrl(`registry.lw.internal/shop/app@${digest}`, digest, registry)).toBe(
      `http://127.0.0.1:5005/v2/registry.lw.internal/shop/app/blobs/${digest}`,
    );
    expect(source.blobUrl(`nginx@${digest}`, digest, registry)).toBe(
      `http://127.0.0.1:5005/v2/docker.io/library/nginx/blobs/${digest}`,
    );
    expect(source.blobUrl(`ghcr.io/acme/app@${digest}`, digest, registry)).toBe(
      `https://ghcr.io/v2/acme/app/blobs/${digest}`,
    );
    expect(() => source.blobUrl('ghcr.io/acme/app', 'sha256:nope', registry)).toThrow(/invalid layer digest/);

    expect(
      bearerTokenUrl('Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:acme/app:pull"'),
    ).toBe('https://ghcr.io/token?service=ghcr.io&scope=repository%3Aacme%2Fapp%3Apull');
    expect(bearerTokenUrl('Bearer realm="http://insecure/token"')).toBeNull();
    expect(bearerTokenUrl('Basic realm="x"')).toBeNull();

    const fetcher = jest.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (url.startsWith('https://ghcr.io/token')) return new Response(JSON.stringify({ token: 't0k' }));

      return init?.headers?.authorization === 'Bearer t0k'
        ? new Response('blob-bytes')
        : new Response('', {
            status: 401,
            headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' },
          });
    });
    const stream = await new RegistryBlobSource(fetcher as never).open(`ghcr.io/acme/app@${digest}`, digest, registry);
    const chunks: Buffer[] = [];

    for await (const chunk of stream) chunks.push(Buffer.from(chunk));

    expect(Buffer.concat(chunks).toString()).toBe('blob-bytes');
    expect(fetcher).toHaveBeenCalledTimes(3);

    const failing = new RegistryBlobSource((async () => new Response('', { status: 404 })) as never);

    await expect(failing.open(`ghcr.io/acme/app@${digest}`, digest, registry)).rejects.toThrow(/HTTP 404/);
  });

  describe('layers', () => {
    const unpacker = (
      digest: (l: string) => string,
      diffId: (l: string) => string,
    ): LayerUnpacker & { count: number } => {
      const u = {
        count: 0,
        unpack: async (_blob: Readable, options: { staging: string }) => {
          u.count++;
          await writeFile(join(options.staging, 'file'), 'content');

          return {
            digest: digest(options.staging),
            diffId: diffId(options.staging),
            bytes: 7,
            entries: 1,
            droppedDevices: 0,
            whiteouts: 0,
          };
        },
      };

      return u;
    };
    const blobs = { open: jest.fn(async () => Readable.from([Buffer.from('x')])) };

    it('unpacks each layer once, verifies both digests and publishes it with a marker', async () => {
      const l = layer('a', 'b');
      const u = unpacker(
        () => l.digest,
        () => l.diffId,
      );
      const cache = new RootfsCache(commandsMock(false) as never, { config, blobs, unpacker: u });

      await Promise.all([
        cache.ensureLayers('ghcr.io/acme/app', [l], registry),
        cache.ensureLayers('ghcr.io/acme/app', [l], registry),
      ]);
      await cache.ensureLayers('ghcr.io/acme/app', [l], registry);

      expect(u.count).toBe(1);
      expect(await readFile(join(layerDir(config, l.diffId), 'file'), 'utf8')).toBe('content');
      expect(JSON.parse(await readFile(layerMarker(config, l.diffId), 'utf8'))).toMatchObject({
        digest: l.digest,
        diffId: l.diffId,
        bytes: 7,
      });
      expect((await stat(config.root)).mode & 0o777).toBe(0o700);
      expect(await cache.usage()).toEqual({ bytes: 7, layers: 1 });
    });

    it('refuses a layer whose content does not match the manifest, leaving nothing behind', async () => {
      const l = layer('a', 'b');
      const cache = new RootfsCache(commandsMock(false) as never, {
        config,
        blobs,
        unpacker: unpacker(
          () => l.digest,
          () => `sha256:${hex('f')}`,
        ),
      });

      await expect(cache.ensureLayers('ghcr.io/acme/app', [l], registry)).rejects.toThrow(/uncompressed digest/);
      await expect(stat(layerDir(config, l.diffId))).rejects.toThrow();
      expect(await cache.layers()).toEqual([]);

      const wrongBlob = new RootfsCache(commandsMock(false) as never, {
        config,
        blobs,
        unpacker: unpacker(
          () => `sha256:${hex('e')}`,
          () => l.diffId,
        ),
      });

      await expect(wrongBlob.ensureLayers('ghcr.io/acme/app', [l], registry)).rejects.toThrow(/blob's digest/);
      await expect(
        wrongBlob.ensureLayers('ghcr.io/acme/app', [{ ...l, mediaType: 'application/x-iso9660' }], registry),
      ).rejects.toThrow(/unsupported layer media type/);
    });

    it('collects least recently used layers the desired state does not need', async () => {
      const cache = new RootfsCache(commandsMock(false) as never, { config: { ...config, cacheMaxBytes: 250 } });

      for (const [c, usedAt] of [
        ['a', '2026-01-03'],
        ['b', '2026-01-01'],
        ['c', '2026-01-02'],
      ] as const) {
        const diffId = `sha256:${hex(c)}`;

        await mkdir(layerDir(config, diffId), { recursive: true });
        await writeFile(
          layerMarker(config, diffId),
          JSON.stringify({ digest: diffId, diffId, bytes: 100, unpackedAt: usedAt, usedAt }),
        );
      }

      cache.setDesired([{ diffId: `sha256:${hex('b')}` }]);

      expect(await cache.gc()).toEqual([hex('c')]);
      await expect(stat(layerDir(config, `sha256:${hex('c')}`))).rejects.toThrow();
      expect((await cache.layers()).map((l) => l.hex).sort()).toEqual([hex('a'), hex('b')]);
    });
  });

  describe('replica roots', () => {
    const layers = [layer('a'), layer('b')];

    it('mounts a thin-LV writable layer and the overlay, and discards both on release', async () => {
      const commands = commandsMock(true);
      const cache = new RootfsCache(commands as never, { config });
      const paths = replicaPaths(config, 'shop/web/app/0');

      expect(await cache.mountReplica('shop/web/app/0', layers, 10 * 1024 ** 3)).toBe(paths.merged);

      const runs = commands.run.mock.calls.map(([command, args]) => [command, ...args].join(' '));

      expect(runs).toEqual([
        expect.stringMatching(
          new RegExp(`^lvcreate -y --config .* -V ${10 * 1024 ** 3}b -T loadweaver/pool -n ${paths.lv}$`),
        ),
        `mkfs.ext4 -q -F -E nodiscard,root_owner=0:0 /dev/loadweaver/${paths.lv}`,
        `mount -t ext4 -o nosuid,nodev,noexec,discard /dev/loadweaver/${paths.lv} ${paths.rw}`,
        `mount -t overlay overlay -o ${overlayMountOptions(config, layers, paths)} ${paths.merged}`,
      ]);
      expect((await stat(paths.upper)).isDirectory()).toBe(true);
      // Classic mount(2): fsconfig() refuses a lowerdir over 256 bytes (3 layers already; spike S3).
      const overlayCall = (commands.run.mock.calls as unknown as [string, string[], unknown][]).find(
        ([c, args]) => c === 'mount' && args.includes('overlay'),
      );

      expect(overlayCall?.[2]).toEqual({
        env: { LIBMOUNT_FORCE_MOUNT2: 'always' },
      });

      // A second mount (restart, other process) re-activates the kept LV instead of formatting it.
      commands.run.mockClear();
      await cache.mountReplica('shop/web/app/0', layers, 10 * 1024 ** 3);
      expect(commands.run.mock.calls.map(([c]) => c)).toEqual(['lvchange', 'mount', 'mount']);

      commands.run.mockClear();
      await cache.release('shop/web/app/0');
      expect(commands.run.mock.calls).toEqual([['lvremove', ['-y', `loadweaver/${paths.lv}`], { okExitCodes: [5] }]]);
      await expect(stat(paths.dir)).rejects.toThrow();
    });

    it('falls back to a sparse loop image without a thin pool', async () => {
      const commands = commandsMock(false);
      const cache = new RootfsCache(commands as never, { config });
      const paths = replicaPaths(config, 'shop/web/app/1');

      await cache.mountReplica('shop/web/app/1', layers, 64 * 1024 ** 2);

      expect((await stat(paths.image)).size).toBe(64 * 1024 ** 2);
      expect(commands.run.mock.calls.map(([command, args]) => [command, ...args].join(' '))).toEqual([
        `mkfs.ext4 -q -F -E nodiscard,root_owner=0:0 ${paths.image}`,
        `mount -t ext4 -o loop,nosuid,nodev,noexec,discard ${paths.image} ${paths.rw}`,
        `mount -t overlay overlay -o ${overlayMountOptions(config, layers, paths)} ${paths.merged}`,
      ]);
      expect(await cache.available()).toEqual({ unpackCache: true, thinPool: false });
    });
  });
});
