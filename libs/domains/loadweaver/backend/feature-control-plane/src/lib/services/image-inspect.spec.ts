import type { RepositoryReader } from '../images/image-signature';
import { inspectImage, inspectImageArchitectures } from './image-resolver.service';

const sha = (c: string) => `sha256:${c.repeat(64)}`;

/** A registry in memory: manifests by digest / tag, blobs by digest. */
function reader(
  manifests: Record<string, unknown>,
  blobs: Record<string, unknown>,
): RepositoryReader & {
  accepts: (string | undefined)[];
} {
  const accepts: (string | undefined)[] = [];

  return {
    accepts,
    manifest: async (reference, accept) => {
      accepts.push(accept);

      return (manifests[reference] as never) ?? null;
    },
    blob: async (digest) => Buffer.from(JSON.stringify(blobs[digest])),
  };
}

describe('image inspection for microVMs and VMs (3.35)', () => {
  const index = {
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
      { digest: sha('1'), platform: { os: 'linux', architecture: 'amd64' } },
      { digest: sha('2'), platform: { os: 'linux', architecture: 'arm64', variant: 'v8' } },
      { digest: sha('3'), platform: { os: 'unknown', architecture: 'unknown' } },
    ],
  };
  const amd64 = {
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: sha('c'), size: 10 },
    layers: [
      { mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: sha('4'), size: 100 },
      { mediaType: 'application/vnd.oci.image.layer.v1.tar+zstd', digest: sha('5'), size: 200 },
    ],
  };
  const config = {
    architecture: 'amd64',
    os: 'linux',
    config: {
      Labels: { 'io.agenstra.microvm.protocol': '1' },
      Entrypoint: ['/init'],
      Cmd: ['run'],
      Env: ['PATH=/usr/bin'],
      User: 'app',
      WorkingDir: '/srv',
      StopSignal: 'SIGINT',
      Healthcheck: { Test: ['CMD', 'true'], Interval: 10_000_000_000, Retries: 2 },
    },
    rootfs: { type: 'layers', diff_ids: [sha('6'), sha('7')] },
  };

  it('picks the linux/<arch> child of an index and reads labels, process and layers', async () => {
    const r = reader({ [sha('0')]: index, [sha('1')]: amd64 }, { [sha('c')]: config });
    const inspection = await inspectImage(r, `registry.lw/shop/app@${sha('0')}`, 'amd64');

    expect(inspection).toEqual({
      manifestDigest: sha('1'),
      platform: 'linux/amd64',
      platforms: ['linux/amd64', 'linux/arm64/v8'],
      labels: { 'io.agenstra.microvm.protocol': '1' },
      config: {
        entrypoint: ['/init'],
        cmd: ['run'],
        env: ['PATH=/usr/bin'],
        user: 'app',
        workingDir: '/srv',
        stopSignal: 'SIGINT',
        healthcheck: { test: ['CMD', 'true'], intervalMs: 10_000, retries: 2 },
      },
      layers: [
        { digest: sha('4'), diffId: sha('6'), size: 100, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip' },
        { digest: sha('5'), diffId: sha('7'), size: 200, mediaType: 'application/vnd.oci.image.layer.v1.tar+zstd' },
      ],
    });
    // Indexes are asked for explicitly.
    expect(r.accepts[0]).toContain('application/vnd.oci.image.index.v1+json');
  });

  it('fails clearly for a missing architecture or mismatched diff ids', async () => {
    await expect(
      inspectImage(reader({ [sha('0')]: { manifests: [index.manifests[1]] } }, {}), `app@${sha('0')}`, 'amd64'),
    ).rejects.toThrow('has no linux/amd64 variant (platforms: linux/arm64/v8)');
    await expect(
      inspectImage(
        reader({ [sha('1')]: amd64 }, { [sha('c')]: { ...config, rootfs: { diff_ids: [sha('6')] } } }),
        `app@${sha('1')}`,
      ),
    ).rejects.toThrow("layers and diff ids don't match");
  });

  it('reads VM image artifacts (config + single disk layer)', async () => {
    const vm = {
      artifactType: 'application/vnd.loadweaver.vm-image.v1',
      config: { mediaType: 'application/vnd.loadweaver.vm-image.config.v1+json', digest: sha('d'), size: 10 },
      layers: [{ mediaType: 'application/vnd.loadweaver.vm-image.disk.qcow2', digest: sha('8'), size: 5000 }],
    };
    const vmConfig = {
      arch: 'amd64',
      format: 'qcow2',
      virtualSize: 10_737_418_240,
      firmware: ['uefi', 'bios'],
      guestAgent: true,
    };

    await expect(
      inspectImage(reader({ [sha('9')]: vm }, { [sha('d')]: vmConfig }), `registry.lw/shop/debian@${sha('9')}`),
    ).resolves.toEqual({
      manifestDigest: sha('9'),
      platform: 'linux/amd64',
      platforms: [],
      labels: {},
      config: {},
      layers: [],
      vmImage: {
        arch: 'amd64',
        format: 'qcow2',
        layerDigest: sha('8'),
        virtualSize: 10_737_418_240,
        firmware: ['uefi', 'bios'],
        guestAgent: true,
      },
    });
    await expect(
      inspectImage(
        reader({ [sha('9')]: vm }, { [sha('d')]: vmConfig }),
        `registry.lw/shop/debian@${sha('9')}`,
        'arm64',
      ),
    ).rejects.toThrow('is amd64, not arm64');
  });

  describe('every cluster architecture (mixed-arch clusters)', () => {
    const arm64 = { ...amd64, config: { ...amd64.config, digest: sha('e') }, layers: [amd64.layers[1]] };
    const armConfig = { ...config, architecture: 'arm64', rootfs: { diff_ids: [sha('f')] } };
    const registry = () =>
      reader(
        { [sha('0')]: index, [sha('1')]: amd64, [sha('2')]: arm64 },
        { [sha('c')]: config, [sha('e')]: armConfig },
      );

    it('is plain inspectImage for a single-arch cluster (no platformLayers, stable spec hashes)', async () => {
      const ref = `registry.lw/shop/app@${sha('0')}`;
      const single = await inspectImageArchitectures(registry(), ref, ['arm64']);

      expect(single).toEqual({ inspection: await inspectImage(registry(), ref, 'arm64'), missing: [] });
      expect(single.inspection.platformLayers).toBeUndefined();
    });

    it('reads the layers of every architecture; labels and process from the first', async () => {
      const { inspection, missing } = await inspectImageArchitectures(registry(), `app@${sha('0')}`, [
        'amd64',
        'arm64',
      ]);

      expect(missing).toEqual([]);
      expect(inspection.platform).toBe('linux/amd64');
      expect(inspection.layers.map((l) => l.digest)).toEqual([sha('4'), sha('5')]);
      expect(inspection.platformLayers).toEqual({
        amd64: [
          { digest: sha('4'), diffId: sha('6'), size: 100, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip' },
          { digest: sha('5'), diffId: sha('7'), size: 200, mediaType: 'application/vnd.oci.image.layer.v1.tar+zstd' },
        ],
        arm64: [
          { digest: sha('5'), diffId: sha('f'), size: 200, mediaType: 'application/vnd.oci.image.layer.v1.tar+zstd' },
        ],
      });
    });

    it('reports the architectures an image lacks and fails when it has none of them', async () => {
      const amdOnly = { manifests: [index.manifests[0]] };
      const r = reader({ [sha('0')]: amdOnly, [sha('1')]: amd64 }, { [sha('c')]: config });
      const { inspection, missing } = await inspectImageArchitectures(r, `app@${sha('0')}`, ['amd64', 'arm64']);

      expect(missing).toEqual(['arm64']);
      expect(Object.keys(inspection.platformLayers ?? {})).toEqual(['amd64']);

      // A single-platform manifest: its config names the architecture.
      const plain = await inspectImageArchitectures(
        reader({ [sha('2')]: arm64 }, { [sha('e')]: armConfig }),
        `app@${sha('2')}`,
        ['amd64', 'arm64'],
      );

      expect(plain.missing).toEqual(['amd64']);
      expect(plain.inspection.platform).toBe('linux/arm64');
      expect(Object.keys(plain.inspection.platformLayers ?? {})).toEqual(['arm64']);

      await expect(
        inspectImageArchitectures(reader({ [sha('0')]: { manifests: [index.manifests[2]] } }, {}), `app@${sha('0')}`, [
          'amd64',
          'arm64',
        ]),
      ).rejects.toThrow("has no variant for the cluster's architectures linux/amd64, linux/arm64");
    });
  });
});
