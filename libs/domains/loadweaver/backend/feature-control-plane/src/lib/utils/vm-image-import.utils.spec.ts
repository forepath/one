import { buildTar } from '@forepath/loadweaver/shared/util-release';
import {
  VM_IMAGE_ARTIFACT_TYPE,
  VM_IMAGE_CONFIG_MEDIA_TYPE,
  VM_IMAGE_DISK_MEDIA_TYPES,
} from '@forepath/loadweaver/shared/util-model';

import {
  detectDiskFormat,
  parseVmImageImportRef,
  qcow2VirtualSize,
  sha256Digest,
  vmImageConfigBlob,
  vmImageLayerDescriptor,
  vmImageManifest,
  vmImageReference,
} from './vm-image-import.utils';

/** A qcow2 v3 header with a virtual size. */
function qcow2Header(virtualSize: number): Buffer {
  const header = Buffer.alloc(512);

  header.writeUInt32BE(0x514649fb, 0);
  header.writeUInt32BE(3, 4);
  header.writeBigUInt64BE(BigInt(virtualSize), 24);

  return header;
}

describe('VM image import helpers (3.35)', () => {
  it('parses refs inside the project namespace', () => {
    expect(parseVmImageImportRef('shop', 'debian-13:20261017')).toEqual({ repository: 'debian-13', tag: '20261017' });
    expect(parseVmImageImportRef('shop', 'registry.lw/shop/os/debian:13')).toEqual({
      repository: 'os/debian',
      tag: '13',
    });
    expect(parseVmImageImportRef('shop', 'registry.lw/other/debian:13')).toBeNull();
    expect(parseVmImageImportRef('shop', 'docker.io/library/debian:13')).toBeNull();
    expect(parseVmImageImportRef('shop', 'Debian:13')).toBeNull();
    expect(parseVmImageImportRef('shop', 'debian')).toBeNull();
    expect(vmImageReference('shop', 'debian', '13', 'sha256:ab')).toBe('registry.lw/shop/debian:13@sha256:ab');
  });

  it('detects qcow2, gzip, zstd, KubeVirt containerDisk tars and raw disks', () => {
    expect(detectDiskFormat(qcow2Header(20 * 1024 ** 3))).toBe('qcow2');
    expect(qcow2VirtualSize(qcow2Header(20 * 1024 ** 3))).toBe(20 * 1024 ** 3);
    expect(detectDiskFormat(Buffer.from([0x1f, 0x8b, 8, 0]))).toBe('gzip');
    expect(detectDiskFormat(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))).toBe('zstd');
    expect(detectDiskFormat(buildTar([{ name: 'disk/fedora.qcow2', data: 'x' }]))).toBe('tar');
    expect(detectDiskFormat(Buffer.alloc(1024))).toBe('raw');
    expect(qcow2VirtualSize(Buffer.alloc(1024))).toBeNull();
  });

  it('builds the OCI artifact: config, single disk layer, artifactType', () => {
    const config = vmImageConfigBlob({ arch: 'amd64', format: 'qcow2', virtualSize: 1024, firmware: ['uefi'] });

    expect(config.descriptor).toEqual({
      mediaType: VM_IMAGE_CONFIG_MEDIA_TYPE,
      digest: sha256Digest(config.data),
      size: config.data.length,
    });
    expect(() => vmImageConfigBlob({ arch: 'arm64', format: 'raw', virtualSize: 1, firmware: ['bios'] })).toThrow();

    const layer = vmImageLayerDescriptor('raw', `sha256:${'a'.repeat(64)}`, 10, 'disk.raw.zst');
    const manifest = vmImageManifest(config.descriptor, layer);
    const parsed = JSON.parse(manifest.data.toString('utf8'));

    expect(manifest.digest).toBe(sha256Digest(manifest.data));
    expect(parsed).toMatchObject({
      schemaVersion: 2,
      artifactType: VM_IMAGE_ARTIFACT_TYPE,
      config: { mediaType: VM_IMAGE_CONFIG_MEDIA_TYPE },
      layers: [{ mediaType: VM_IMAGE_DISK_MEDIA_TYPES.raw, size: 10 }],
    });
  });
});
