import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

import {
  aptBundleIndexSchema,
  aptPackPath,
  buildAptBundleSnapshot,
  bundleAptRoots,
  collectAptBundleBlobs,
  compareDebianVersions,
  importAptBundlePacks,
  kernelsWithoutKvmModules,
  parseControlStanzas,
  selectAptPackages,
  selectedKernels,
  writeAptPack,
} from './apt-bundle';
import { memoryPoolIndex, serveAptFile, type BlobStore } from './apt-snapshot.core';
import type { AptUpstream } from './apt-snapshot.utils';
import { MICROVM_HOST_PACKAGES, REQUIRED_HOST_PACKAGES } from './pins';
import { buildManifest } from './source-manifest';
import { buildTar } from './tar';

const CP = `ghcr.io/forepath/loadweaver-control-plane-api:3.6.0@sha256:${'c'.repeat(64)}`;
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

function memoryStore(): BlobStore & { blobs: Map<string, Buffer> } {
  const blobs = new Map<string, Buffer>();

  return {
    blobs,
    has: async (s) => blobs.has(s),
    put: async (s, size, body) => {
      const chunks: Buffer[] = [];

      for await (const c of body) chunks.push(Buffer.from(c));

      const data = Buffer.concat(chunks);

      if (data.length !== size || sha(data) !== s) throw new Error('mismatch');

      blobs.set(s, data);
    },
    get: async (s) =>
      blobs.has(s) ? { size: (blobs.get(s) as Buffer).length, stream: Readable.from([blobs.get(s) as Buffer]) } : null,
  };
}

async function read(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const c of stream) chunks.push(Buffer.from(c));

  return Buffer.concat(chunks);
}

/** A `Packages` stanza for a fake .deb. */
function stanza(fields: Record<string, string>, deb: Buffer, path: string): string {
  return [
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
    `Filename: ${path}`,
    `Size: ${deb.length}`,
    `SHA256: ${sha(deb)}`,
  ].join('\n');
}

describe('bundled apt snapshot (3.26, air-gapped)', () => {
  it('compares Debian versions like dpkg', () => {
    const lt = (a: string, b: string) => expect([a, b, compareDebianVersions(a, b) < 0]).toEqual([a, b, true]);

    lt('1.0', '1.0-1');
    lt('1.0~rc1', '1.0');
    lt('1.9', '1.10');
    lt('1:9.9', '2:1.0');
    lt('6.12.107-1', '6.12.113-1');
    lt('2.17.5-0+deb13u1', '2.17.5-1');
    lt('1.0', '1.0+deb13u1');
    lt('1.0a', '1.0b');
    lt('1.0~~', '1.0~');
    expect(compareDebianVersions('0:1.00-1', '1.0-1')).toBe(0);
    expect(compareDebianVersions('5:29.9.1-1~debian.13~trixie', '5:29.9.0-1~debian.13~trixie')).toBeGreaterThan(0);
  });

  it('parses control stanzas with continuation lines', () => {
    expect(parseControlStanzas('Package: a\nDescription: x\n more\n\nPackage: b\nDepends: c\n')).toEqual([
      { Package: 'a', Description: 'x\nmore' },
      { Package: 'b', Depends: 'c' },
    ]);
  });

  describe('package selection', () => {
    const c = (source: string, fields: Record<string, string>) => ({
      source,
      stanza: {
        Filename: `pool/main/${fields['Package'][0]}/${fields['Package']}/${fields['Package']}_${fields['Version']}_amd64.deb`,
        SHA256: sha(`${fields['Package']}=${fields['Version']}`),
        Size: '10',
        ...fields,
      },
    });
    const universe = [
      c('debian', { Package: 'base-files', Version: '13.8', Priority: 'required' }),
      c('debian', {
        Package: 'bird2',
        Version: '2.17.5-0+deb13u1',
        Depends: 'libc6 (>= 2.38), libssh-4 | libssh-gcrypt-4',
      }),
      c('debian-security', { Package: 'bird2', Version: '2.17.6-0+deb13u1' }),
      c('debian', { Package: 'libc6', Version: '2.41-12' }),
      c('debian-security', { Package: 'libc6', Version: '2.41-12+deb13u1' }),
      c('debian', { Package: 'libssh-gcrypt-4', Version: '0.11' }),
      c('debian', {
        Package: 'linux-image-cloud-amd64',
        Version: '6.12.113-1',
        Depends: 'linux-image-6.12.113+deb13-cloud-amd64 (= 6.12.113-1)',
      }),
      c('debian-security', {
        Package: 'linux-image-6.12.113+deb13-cloud-amd64',
        Version: '6.12.113-1',
        Recommends: 'firmware-free',
        'Pre-Depends': 'initramfs',
      }),
      c('debian', { Package: 'dracut', Version: '1', Provides: 'initramfs' }),
      c('debian', { Package: 'tiny-initramfs', Version: '1', Provides: 'initramfs' }),
      c('debian', { Package: 'firmware-free', Version: '1' }),
      c('debian', { Package: 'unrelated', Version: '1', Priority: 'optional' }),
      c('debian', { Package: 'broken', Version: '1', Depends: 'nowhere' }),
    ];

    it('takes the roots, required / important packages and their closure: newest version, or the pin', () => {
      const selection = selectAptPackages(universe, ['bird2', 'linux-image-cloud-amd64', 'gone', 'broken'], {
        bird2: '2.17.5-0+deb13u1',
      });

      expect(selection.packages).toEqual([
        'base-files=13.8',
        'bird2=2.17.5-0+deb13u1',
        'broken=1',
        'dracut=1',
        'firmware-free=1',
        'libc6=2.41-12+deb13u1',
        'libssh-gcrypt-4=0.11',
        'linux-image-6.12.113+deb13-cloud-amd64=6.12.113-1',
        'linux-image-cloud-amd64=6.12.113-1',
      ]);
      expect(selection.missingRoots).toEqual(['gone']);
      expect(selection.unresolved).toEqual(['broken: nowhere']);
      expect(selection.missingPins).toEqual([]);
      expect(selection.pool.find((p) => p.path.includes('libc6'))).toEqual({
        source: 'debian-security',
        path: 'pool/main/l/libc6/libc6_2.41-12+deb13u1_amd64.deb',
        sha256: sha('libc6=2.41-12+deb13u1'),
        size: 10,
      });
      expect(selectedKernels(selection.packages)).toEqual(['6.12.113+deb13-cloud-amd64']);
    });

    it('falls back to the newest version when the pinned one is gone', () => {
      const selection = selectAptPackages(universe, ['bird2'], { bird2: '2.0' });

      expect(selection.missingPins).toEqual(['bird2=2.0']);
      expect(selection.packages).toContain('bird2=2.17.6-0+deb13u1');
    });

    it('names the kernels, Loadweaver host packages and DRBD build tools as roots per OS', () => {
      expect(bundleAptRoots('debian:13', 'arm64')).toEqual(
        expect.arrayContaining(['linux-image-cloud-arm64', 'linux-headers-cloud-arm64', 'drbd-utils', 'gcc', 'bird2']),
      );
      expect(bundleAptRoots('ubuntu:24.04', 'amd64')).toEqual(
        expect.arrayContaining(['linux-image-generic-hwe-24.04', 'linux-headers-virtual', 'docker-ce']),
      );
    });

    it('roots the microVM host packages (attr, e2fsprogs) for every supported OS and architecture (3.35)', () => {
      for (const os of ['debian:12', 'debian:13', 'ubuntu:22.04', 'ubuntu:24.04'])
        for (const arch of ['amd64', 'arm64'])
          expect(bundleAptRoots(os, arch)).toEqual(expect.arrayContaining([...MICROVM_HOST_PACKAGES]));

      expect(MICROVM_HOST_PACKAGES).toEqual(['attr', 'e2fsprogs']);
    });

    it('roots every required host package (host updates install missing ones from the snapshot)', () => {
      expect(REQUIRED_HOST_PACKAGES).toEqual(expect.arrayContaining([...MICROVM_HOST_PACKAGES]));

      for (const os of ['debian:12', 'debian:13', 'ubuntu:22.04', 'ubuntu:24.04'])
        for (const arch of ['amd64', 'arm64'])
          expect(bundleAptRoots(os, arch)).toEqual(expect.arrayContaining([...REQUIRED_HOST_PACKAGES]));
    });

    it('roots the KVM modules of every bundled Ubuntu kernel (linux-modules-extra), on amd64 and arm64 (3.1)', () => {
      for (const arch of ['amd64', 'arm64'])
        expect(bundleAptRoots('ubuntu:22.04', arch)).toEqual(
          expect.arrayContaining(['linux-image-extra-virtual', 'linux-image-extra-virtual-hwe-22.04']),
        );

      // Debian ships KVM in linux-image-*: nothing extra.
      expect(bundleAptRoots('debian:12', 'amd64').filter((r) => r.includes('extra'))).toEqual([]);
    });

    it('selects linux-modules-extra for exactly the kernels the Ubuntu metapackages bring', () => {
      const k1 = '6.8.0-90-generic';
      const k2 = '6.14.0-37-generic';
      const ubuntu = [
        c('ubuntu', { Package: 'linux-image-virtual', Version: '6.8.0-90.91', Depends: 'linux-image-' + k1 }),
        c('ubuntu', {
          Package: 'linux-image-extra-virtual',
          Version: '6.8.0-90.91',
          Depends: `linux-image-generic (= 6.8.0-90.91)`,
        }),
        c('ubuntu', {
          Package: 'linux-image-generic',
          Version: '6.8.0-90.91',
          Depends: `linux-image-${k1}, linux-modules-extra-${k1}`,
        }),
        c('ubuntu', {
          Package: 'linux-image-virtual-hwe-24.04',
          Version: '6.14.0-37.37',
          Depends: 'linux-image-' + k2,
        }),
        c('ubuntu', {
          Package: 'linux-image-extra-virtual-hwe-24.04',
          Version: '6.14.0-37.37',
          Depends: `linux-image-generic-hwe-24.04 (= 6.14.0-37.37)`,
        }),
        c('ubuntu', {
          Package: 'linux-image-generic-hwe-24.04',
          Version: '6.14.0-37.37',
          Depends: `linux-image-${k2}, linux-modules-extra-${k2}`,
        }),
        c('ubuntu', { Package: `linux-image-${k1}`, Version: '6.8.0-90.91', Depends: `linux-modules-${k1}` }),
        c('ubuntu', { Package: `linux-image-${k2}`, Version: '6.14.0-37.37', Depends: `linux-modules-${k2}` }),
        c('ubuntu', { Package: `linux-modules-${k1}`, Version: '6.8.0-90.91' }),
        c('ubuntu', { Package: `linux-modules-${k2}`, Version: '6.14.0-37.37' }),
        c('ubuntu', { Package: `linux-modules-extra-${k1}`, Version: '6.8.0-90.91' }),
        c('ubuntu', { Package: `linux-modules-extra-${k2}`, Version: '6.14.0-37.37' }),
      ];
      const roots = bundleAptRoots('ubuntu:24.04', 'amd64');
      const selection = selectAptPackages(ubuntu, roots);
      const kernels = selectedKernels(selection.packages);

      expect(kernels).toEqual([k2, k1].sort());

      for (const k of kernels)
        expect(selection.packages.some((p) => p.startsWith(`linux-modules-extra-${k}=`))).toBe(true);

      expect(kernelsWithoutKvmModules('ubuntu:24.04', selection.packages)).toEqual([]);
      // Without the extra metapackages the -generic kernels still have KVM: it is in linux-modules-<k> (spike S8).
      const bare = selectAptPackages(
        ubuntu,
        roots.filter((r) => !r.startsWith('linux-image-extra-') && !r.startsWith('linux-image-generic')),
      );

      expect(bare.packages.some((p) => p.startsWith('linux-modules-extra-'))).toBe(false);
      expect(kernelsWithoutKvmModules('ubuntu:24.04', bare.packages)).toEqual([]);
      expect(kernelsWithoutKvmModules('debian:13', bare.packages)).toEqual([]);
    });

    it('knows where each Ubuntu kernel flavour has its KVM modules (spike S8: Contents index of noble-updates)', () => {
      const pkgs = (...names: string[]) => names.map((n) => `${n}=1`);

      // 24.04's 7.0 HWE kernel has no linux-modules-extra at all; KVM is in linux-modules (as for 6.8 -generic).
      expect(
        kernelsWithoutKvmModules(
          'ubuntu:24.04',
          pkgs('linux-image-7.0.0-38-generic', 'linux-modules-7.0.0-38-generic', 'linux-image-6.8.0-147-generic'),
        ),
      ).toEqual(['6.8.0-147-generic']);
      expect(
        kernelsWithoutKvmModules(
          'ubuntu:24.04',
          pkgs('linux-image-6.8.0-147-generic-64k', 'linux-modules-6.8.0-147-generic-64k'),
        ),
      ).toEqual([]);
      // Other flavours still need linux-modules-extra.
      expect(
        kernelsWithoutKvmModules('ubuntu:22.04', pkgs('linux-image-6.8.0-1040-aws', 'linux-modules-6.8.0-1040-aws')),
      ).toEqual(['6.8.0-1040-aws']);
      expect(
        kernelsWithoutKvmModules(
          'ubuntu:22.04',
          pkgs('linux-image-6.8.0-1040-aws', 'linux-modules-6.8.0-1040-aws', 'linux-modules-extra-6.8.0-1040-aws'),
        ),
      ).toEqual([]);
    });
  });

  describe('builder and control plane', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'lw-apt-bundle-'));
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    // A fake upstream: one Debian 13 archive (amd64) and one Ubuntu archive sharing one .deb (deduplicated).
    const bird = Buffer.from('bird2 deb');
    const shared = Buffer.from('shared arch-all deb');
    const extra = Buffer.from('not selected');
    const debPackages = gzipSync(
      [
        stanza(
          { Package: 'bird2', Version: '2.17.5-0+deb13u1', Depends: 'tzdata' },
          bird,
          'pool/main/b/bird2/bird2_2.17.5_amd64.deb',
        ),
        stanza(
          { Package: 'tzdata', Version: '2026a', Priority: 'required' },
          shared,
          'pool/main/t/tzdata/tzdata_2026a_all.deb',
        ),
        stanza({ Package: 'unrelated', Version: '1' }, extra, 'pool/main/u/unrelated/unrelated_1_amd64.deb'),
        '',
      ].join('\n\n'),
    );
    const ubuPackages = gzipSync(
      [
        stanza(
          { Package: 'tzdata', Version: '2026a', Priority: 'required' },
          shared,
          'pool/main/t/tzdata/tzdata_2026a_all.deb',
        ),
        '',
      ].join('\n\n'),
    );
    const inRelease = (packagesGz: Buffer) =>
      `Origin: Test\nSHA256:\n ${sha(packagesGz)} ${packagesGz.length} main/binary-amd64/Packages.gz\n`;
    const upstreams: AptUpstream[] = [
      {
        name: 'debian-trixie',
        url: 'https://deb.example/debian',
        suites: ['trixie'],
        components: ['main'],
        arches: ['amd64'],
        keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
        os: 'debian:13',
      },
      {
        name: 'ubuntu-noble',
        url: 'https://deb.example/ubuntu',
        suites: ['noble'],
        components: ['main'],
        arches: ['amd64'],
        keyring: '/usr/share/keyrings/ubuntu-archive-keyring.gpg',
        os: 'ubuntu:24.04',
      },
    ];
    const upstreamFiles: Record<string, Buffer | string> = {
      'https://deb.example/debian/dists/trixie/InRelease': inRelease(debPackages),
      'https://deb.example/debian/dists/trixie/main/binary-amd64/Packages.gz': debPackages,
      'https://deb.example/debian/pool/main/b/bird2/bird2_2.17.5_amd64.deb': bird,
      'https://deb.example/debian/pool/main/t/tzdata/tzdata_2026a_all.deb': shared,
      'https://deb.example/ubuntu/dists/noble/InRelease': inRelease(ubuPackages),
      'https://deb.example/ubuntu/dists/noble/main/binary-amd64/Packages.gz': ubuPackages,
      'https://deb.example/ubuntu/pool/main/t/tzdata/tzdata_2026a_all.deb': shared,
    };
    const upstream = (files: Record<string, Buffer | string> = upstreamFiles) =>
      jest.fn(async (url: string) =>
        files[url] === undefined
          ? new Response('nope', { status: 404 })
          : new Response(new Uint8Array(Buffer.from(files[url]))),
      );

    const snapshot = async (store = memoryStore()) => ({
      store,
      ...(await buildAptBundleSnapshot(
        [
          { os: 'debian:13', arch: 'amd64' },
          { os: 'ubuntu:24.04', arch: 'amd64' },
        ],
        store,
        { id: 's-bundle-3-6-0', upstreams, fetchImpl: upstream() },
      )),
    });

    it('freezes the indexes and selects the packages per host into the index', async () => {
      const { index, selections } = await snapshot();

      expect(aptBundleIndexSchema.parse(index)).toEqual(index);
      expect(Object.keys(index.files).sort()).toEqual([
        'debian-trixie/dists/trixie/InRelease',
        'debian-trixie/dists/trixie/main/binary-amd64/Packages.gz',
        'ubuntu-noble/dists/noble/InRelease',
        'ubuntu-noble/dists/noble/main/binary-amd64/Packages.gz',
      ]);
      // bird2 (a Loadweaver root) with its dependency; tzdata (required) on both; `unrelated` never.
      expect(index.pool.map((p) => `${p.source}/${p.path}`)).toEqual([
        'debian-trixie/pool/main/b/bird2/bird2_2.17.5_amd64.deb',
        'debian-trixie/pool/main/t/tzdata/tzdata_2026a_all.deb',
        'ubuntu-noble/pool/main/t/tzdata/tzdata_2026a_all.deb',
      ]);
      expect(selections['debian:13/amd64'].packages).toEqual(['bird2=2.17.5-0+deb13u1', 'tzdata=2026a']);
    });

    it('fetches every listed file by checksum (local cache first), verifies, dedupes and packs per OS', async () => {
      const { index, store } = await snapshot();
      const cache = join(dir, 'cache');
      const fetchImpl = upstream();

      // The snapshot step's frozen indexes as the local cache (`--apt-files`).
      mkdirSync(cache);

      for (const [hash, data] of store.blobs) writeFileSync(join(cache, hash), data);

      const groups = await collectAptBundleBlobs(index, { workDir: join(dir, 'work'), cacheDir: cache, fetchImpl });

      // Indexes from the cache, packages from upstream — the shared .deb only once.
      expect(fetchImpl.mock.calls.map(([url]) => url).sort()).toEqual([
        'https://deb.example/debian/pool/main/b/bird2/bird2_2.17.5_amd64.deb',
        'https://deb.example/debian/pool/main/t/tzdata/tzdata_2026a_all.deb',
      ]);
      expect(groups.map((g) => [g.os, g.blobs.length])).toEqual([
        ['debian:13', 4],
        ['ubuntu:24.04', 2],
      ]);
      expect(groups[1].blobs.map((b) => b.sha256)).not.toContain(sha(shared));

      for (const group of groups)
        for (const blob of group.blobs) expect(sha(readFileSync(blob.local))).toBe(blob.sha256);

      // The packs are artifacts of the manifest (signed with it).
      expect(aptPackPath('ubuntu:24.04')).toBe('artifacts/apt/packages-ubuntu-24.04.tar');

      const file = (path: string, data: string) => ({ path, sha256: sha(data), size: data.length });
      const manifest = buildManifest({
        version: '3.6.0',
        channel: 'stable',
        created: '2026-10-20T00:00:00.000Z',
        images: { 'control-plane': CP },
        agentBinaries: { amd64: file('artifacts/bin/loadweaver-agent-linux-amd64', 'agent') },
        aptSnapshot: file('artifacts/apt/snapshot.json', 'index'),
        aptPackages: groups.map((g) => file(aptPackPath(g.os), g.os)),
      });

      expect(manifest.aptPackages).toEqual([
        'artifacts/apt/packages-debian-13.tar',
        'artifacts/apt/packages-ubuntu-24.04.tar',
      ]);
      expect(manifest.artifacts.map((a) => a.path)).toEqual(expect.arrayContaining(manifest.aptPackages as string[]));
      expect(() =>
        buildManifest({
          version: '3.6.0',
          channel: 'stable',
          created: '2026-10-20T00:00:00.000Z',
          images: { 'control-plane': CP },
          agentBinaries: { amd64: file('artifacts/bin/loadweaver-agent-linux-amd64', 'agent') },
          aptPackages: [file(aptPackPath('debian:13'), 'x')],
        }),
      ).toThrow('apt packages need the apt snapshot index');
    });

    it('fails the build when upstream serves other bytes than the index names', async () => {
      const { index } = await snapshot();

      await expect(
        collectAptBundleBlobs(index, {
          workDir: join(dir, 'work'),
          fetchImpl: upstream({
            ...upstreamFiles,
            'https://deb.example/debian/pool/main/b/bird2/bird2_2.17.5_amd64.deb': 'tampered',
          }),
        }),
      ).rejects.toThrow(/does not match its checksum in the snapshot index|larger than the index says/);
    });

    it('control plane: unpacks the packs into its store and serves the snapshot without upstream (air-gapped)', async () => {
      const { index } = await snapshot();
      const groups = await collectAptBundleBlobs(index, { workDir: join(dir, 'work'), fetchImpl: upstream() });
      const packs: string[] = [];

      for (const group of groups) {
        const path = join(dir, `${group.os.replace(':', '-')}.tar`);

        await writeAptPack(path, group.blobs);
        packs.push(path);
      }

      const store = memoryStore();
      const pool = memoryPoolIndex();
      const result = await importAptBundlePacks(
        index,
        packs.map((p) => Readable.from([readFileSync(p)])),
        store,
        pool,
      );

      expect(result).toEqual({ stored: 6, present: 0, missing: [] });
      expect(await pool.get('https://deb.example/ubuntu', 'pool/main/t/tzdata/tzdata_2026a_all.deb')).toEqual({
        sha256: sha(shared),
        size: shared.length,
      });

      // Upstream is unreachable: everything comes from the bundle's files.
      const offline = jest.fn(async () => {
        throw new Error('no network');
      });
      const snapshotRow = { sources: index.sources, files: index.files };
      const deb = await serveAptFile(
        snapshotRow,
        'debian-trixie',
        'pool/main/b/bird2/bird2_2.17.5_amd64.deb',
        store,
        pool,
        offline,
      );

      expect(await read((deb as { stream: Readable }).stream)).toEqual(bird);

      const inRel = await serveAptFile(snapshotRow, 'ubuntu-noble', 'dists/noble/InRelease', store, pool, offline);

      expect((await read((inRel as { stream: Readable }).stream)).toString()).toBe(inRelease(ubuPackages));
      // Even without a pool row: a package already in the store by its checksum is served from there.
      const bare = await serveAptFile(
        snapshotRow,
        'ubuntu-noble',
        'pool/main/t/tzdata/tzdata_2026a_all.deb',
        store,
        memoryPoolIndex(),
        offline,
      );

      expect(await read((bare as { stream: Readable }).stream)).toEqual(shared);
      expect(offline).not.toHaveBeenCalled();

      // Re-import: nothing stored twice.
      expect(
        await importAptBundlePacks(
          index,
          packs.map((p) => Readable.from([readFileSync(p)])),
          store,
          pool,
        ),
      ).toMatchObject({ stored: 0, present: 6 });
    });

    it('control plane: refuses pack members the index does not name, reports files no pack carried', async () => {
      const { index } = await snapshot();
      const store = memoryStore();

      await expect(
        importAptBundlePacks(
          index,
          [Readable.from([buildTar([{ name: sha('evil'), data: 'evil' }])])],
          store,
          memoryPoolIndex(),
        ),
      ).rejects.toThrow('is not a file of the bundle');

      const result = await importAptBundlePacks(index, [], store, memoryPoolIndex());

      expect(result.stored).toBe(0);
      expect(result.missing).toHaveLength(7);
      expect(store.blobs.size).toBe(0);
    });
  });
});
