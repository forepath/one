import { gzipSync } from 'node:zlib';

import { buildTar, tarHeader, tarPadding } from '@forepath/loadweaver/shared/util-release';

import type { RepositoryReader } from '../images/image-signature';
import { containerDiskEntry, decompressedPrefix, inspectVmImage } from './image-resolver.service';

const sha = (c: string) => `sha256:${c.repeat(64)}`;

function qcow2(virtualSize: number): Buffer {
  const header = Buffer.alloc(512);

  header.writeUInt32BE(0x514649fb, 0);
  header.writeUInt32BE(3, 4);
  header.writeBigUInt64BE(BigInt(virtualSize), 24);

  return header;
}

/** A containerDisk image: config + one or two layers, the disk layer's first bytes peekable. */
function reader(layers: Record<string, Buffer>, arch = 'amd64', withPrefix = true): RepositoryReader {
  const digests = Object.keys(layers);
  const manifest = {
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: sha('c'), size: 10 },
    layers: digests.map((d) => ({ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: d, size: 1 })),
  };
  const config = { architecture: arch, os: 'linux', config: {}, rootfs: { diff_ids: digests.map(() => sha('e')) } };

  return {
    manifest: async () => manifest as never,
    blob: async () => Buffer.from(JSON.stringify(config)),
    ...(withPrefix ? { blobPrefix: async (digest: string, bytes: number) => layers[digest].subarray(0, bytes) } : {}),
  };
}

describe('KubeVirt containerDisk detection at plan time (3.35)', () => {
  const disk = Buffer.concat([qcow2(5 * 1024 ** 3), Buffer.alloc(300 * 1024, 3)]);
  const layer = gzipSync(
    buildTar([
      { name: 'disk/fedora.qcow2', data: disk },
      { name: 'disk/other.img', data: 'x' },
    ]),
  );

  it('treats an image whose layer holds /disk/*.qcow2 as a VM image (format, size, layer, firmware)', async () => {
    const inspection = await inspectVmImage(
      reader({ [sha('1')]: gzipSync(buildTar([{ name: 'etc/os-release', data: 'x' }])), [sha('2')]: layer }),
      `quay.io/containerdisks/fedora@${sha('9')}`,
    );

    expect(inspection.vmImage).toEqual({
      arch: 'amd64',
      format: 'qcow2',
      layerDigest: sha('2'),
      virtualSize: 5 * 1024 ** 3,
      firmware: ['uefi', 'bios'],
      containerDisk: { path: 'disk/fedora.qcow2' },
    });
  });

  it('reads raw .img disks (entry size), arm64 (UEFI only), pax / long names; ignores other images', async () => {
    const raw = gzipSync(buildTar([{ name: 'disk/cirros.img', data: Buffer.alloc(4096, 1) }]));
    const arm = await inspectVmImage(reader({ [sha('1')]: raw }, 'arm64'), `x/y@${sha('9')}`, 'arm64');

    expect(arm.vmImage).toMatchObject({ arch: 'arm64', format: 'raw', virtualSize: 4096, firmware: ['uefi'] });

    const plain = await inspectVmImage(
      reader({ [sha('1')]: gzipSync(buildTar([{ name: 'app/server', data: 'x' }])) }),
      `x/y@${sha('9')}`,
    );

    expect(plain.vmImage).toBeUndefined();
    expect((await inspectVmImage(reader({ [sha('2')]: layer }, 'amd64', false), `x/y@${sha('9')}`)).vmImage).toBe(
      undefined,
    );

    const longName = `disk/${'a'.repeat(120)}.qcow2`;
    const gnu = Buffer.concat([
      (() => {
        const header = tarHeader('././@LongLink', longName.length + 1);

        header[156] = 'L'.charCodeAt(0);

        // Recompute the checksum after changing the type.
        header.fill(0x20, 148, 156);

        let sum = 0;

        for (const b of header) sum += b;

        header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'binary');

        return header;
      })(),
      Buffer.from(`${longName}\0`),
      tarPadding(longName.length + 1),
      tarHeader('disk/short.qcow2', disk.length),
      disk,
    ]);

    expect(containerDiskEntry(gnu)).toEqual({ path: longName, format: 'qcow2', virtualSize: 5 * 1024 ** 3 });
  });

  it('decodes a truncated gzip prefix as far as it goes', async () => {
    const prefix = layer.subarray(0, 4096);
    const decoded = await decompressedPrefix(prefix);

    expect(decoded.length).toBeGreaterThan(512);
    expect(containerDiskEntry(decoded)).toMatchObject({ path: 'disk/fedora.qcow2', format: 'qcow2' });
  });
});
