import {
  detectVmDiskFormat,
  isVmImageManifest,
  qcow2HasBackingFile,
  qcow2VirtualSize,
  vmImageLayerTitle,
  vmImageManifestDocument,
} from './vm-image';

function qcow2(virtualSize: number, backing = 0): Uint8Array {
  const header = new Uint8Array(512);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x514649fb);
  view.setUint32(12, backing);
  view.setUint32(24, Math.floor(virtualSize / 2 ** 32));
  view.setUint32(28, virtualSize % 2 ** 32);

  return header;
}

describe('VM image artifact helpers (3.35)', () => {
  it('detects disk formats and reads qcow2 headers', () => {
    expect(detectVmDiskFormat(qcow2(20 * 1024 ** 3))).toBe('qcow2');
    expect(qcow2VirtualSize(qcow2(20 * 1024 ** 3))).toBe(20 * 1024 ** 3);
    expect(qcow2HasBackingFile(qcow2(1024))).toBe(false);
    expect(qcow2HasBackingFile(qcow2(1024, 512))).toBe(true);
    expect(detectVmDiskFormat(new Uint8Array([0x1f, 0x8b, 8, 0]))).toBe('gzip');
    expect(detectVmDiskFormat(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]))).toBe('zstd');

    const tar = new Uint8Array(512);

    tar.set([0x75, 0x73, 0x74, 0x61, 0x72], 257);
    expect(detectVmDiskFormat(tar)).toBe('tar');
    expect(detectVmDiskFormat(new Uint8Array(1024))).toBe('raw');
    expect(qcow2VirtualSize(new Uint8Array(1024))).toBeNull();
  });

  it('builds and recognises VM image manifests', () => {
    const manifest = vmImageManifestDocument(
      { mediaType: 'application/vnd.loadweaver.vm-image.config.v1+json', digest: 'sha256:c', size: 1 },
      { mediaType: 'application/vnd.loadweaver.vm-image.disk.qcow2', digest: 'sha256:l', size: 2 },
    );

    expect(manifest).toMatchObject({ schemaVersion: 2, artifactType: 'application/vnd.loadweaver.vm-image.v1' });
    expect(manifest).not.toHaveProperty('annotations');
    expect(isVmImageManifest(manifest)).toBe(true);
    expect(isVmImageManifest({ config: { mediaType: 'application/vnd.oci.image.config.v1+json' } })).toBe(false);
    expect(vmImageLayerTitle('raw')).toBe('disk.raw.zst');
  });
});
