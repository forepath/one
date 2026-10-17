import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { inspectDrbdCompatEntry } from './drbd-compat';
import { referencedArtifacts, releaseManifestSchema, type KernelModuleComponent } from './manifest';
import { buildManifest } from './source-manifest';
import { buildTar } from './tar';

const KERNEL = '6.12.113+deb13-cloud-amd64';
const COMPAT_H = '/* compat.h */\n#define COMPAT_HAVE_FOO\n';
const MD5 = createHash('md5').update(COMPAT_H).digest('hex');

function entry(files: { name: string; data: string }[]): Buffer {
  return gzipSync(buildTar(files));
}

const good = () =>
  entry([
    { name: `cocci_cache/${MD5}/compat.h`, data: COMPAT_H },
    { name: `cocci_cache/${MD5}/compat.patch`, data: '--- a\n+++ b\n' },
    { name: `cocci_cache/${MD5}/kernelrelease.txt`, data: `${KERNEL}\n` },
  ]);

describe('DRBD compat entries (air-gapped builds, 3.26)', () => {
  it('accepts one cocci_cache directory whose name is the MD5 of its compat.h, for the listed kernel', async () => {
    await expect(inspectDrbdCompatEntry(good(), KERNEL)).resolves.toEqual({
      md5: MD5,
      kernels: [KERNEL],
      patchBytes: 12,
    });
  });

  it('refuses another kernel, a wrong checksum, missing / extra files and paths outside the cache', async () => {
    await expect(inspectDrbdCompatEntry(good(), '6.12.114+deb13-cloud-amd64')).rejects.toThrow(
      'kernelrelease.txt does not list',
    );
    await expect(
      inspectDrbdCompatEntry(
        entry([
          { name: `cocci_cache/${'0'.repeat(32)}/compat.h`, data: COMPAT_H },
          { name: `cocci_cache/${'0'.repeat(32)}/compat.patch`, data: '' },
          { name: `cocci_cache/${'0'.repeat(32)}/kernelrelease.txt`, data: KERNEL },
        ]),
        KERNEL,
      ),
    ).rejects.toThrow(/compat.h has MD5/);
    await expect(
      inspectDrbdCompatEntry(entry([{ name: `cocci_cache/${MD5}/compat.h`, data: COMPAT_H }]), KERNEL),
    ).rejects.toThrow('compat.patch is missing');
    await expect(
      inspectDrbdCompatEntry(
        entry([
          { name: `cocci_cache/${MD5}/compat.h`, data: COMPAT_H },
          { name: `cocci_cache/${MD5}/compat.patch`, data: '' },
          { name: `cocci_cache/${MD5}/kernelrelease.txt`, data: KERNEL },
          { name: `cocci_cache/${MD5}/Makefile`, data: 'x' },
        ]),
        KERNEL,
      ),
    ).rejects.toThrow('unexpected file');
    await expect(inspectDrbdCompatEntry(entry([{ name: 'drbd/Makefile', data: 'x' }]), KERNEL)).rejects.toThrow(
      'unexpected path',
    );
  });

  it('lists compat entries in the drbd component and as artifacts (checksummed, signed)', () => {
    const file = { path: `artifacts/drbd/compat/${KERNEL}-amd64.tar.gz`, sha256: 'a'.repeat(64), size: 300 };
    const manifest = buildManifest({
      version: '3.5.0',
      channel: 'stable',
      created: '2026-10-20T00:00:00.000Z',
      images: { 'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:3.5.0@sha256:${'c'.repeat(64)}` },
      agentBinaries: {},
      drbdCompat: [{ kernel: KERNEL, arch: 'amd64', file, md5: MD5 }],
    });
    const drbd = manifest.components['drbd'] as KernelModuleComponent;

    expect(drbd.compat).toEqual([{ kernel: KERNEL, arch: 'amd64', file: file.path, md5: MD5 }]);
    expect(manifest.artifacts).toContainEqual(file);
    expect(referencedArtifacts(manifest)).toContain(file.path);
    // Without compat entries the field is absent (older manifests stay byte-identical).
    const plain = buildManifest({
      version: '3.5.0',
      channel: 'stable',
      created: '2026-10-20T00:00:00.000Z',
      images: { 'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:3.5.0@sha256:${'c'.repeat(64)}` },
      agentBinaries: {},
    });

    expect('compat' in (plain.components['drbd'] as object)).toBe(false);
    // A compat entry whose file isn't listed is refused.
    expect(() => releaseManifestSchema.parse({ ...manifest, artifacts: [] })).toThrow(/is referenced but not listed/);
  });
});
