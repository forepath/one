import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

import { memoryPoolIndex, parsePackagesIndex, serveAptFile, takeSnapshot, type BlobStore } from './apt-snapshot.core';
import {
  acquireByHash,
  aptUpstreams,
  classifyAptPath,
  defaultAptUpstreams,
  hostOs,
  indexFiles,
  releaseChecksums,
  snapshotId,
  validateUpstream,
} from './apt-snapshot.utils';

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

describe('cluster-local apt source (3.26)', () => {
  const deb = Buffer.from('a .deb file');
  const evilDeb = Buffer.from('not in any index');
  const packagesPlain = Buffer.from(
    [
      'Package: bird2',
      'Version: 2.17.5-0+deb13u1',
      'Filename: pool/main/b/bird2/bird2_2.17.5-0+deb13u1_amd64.deb',
      `Size: ${deb.length}`,
      `SHA256: ${sha(deb)}`,
      '',
      'Package: other',
      'Filename: pool/main/o/other/other_1.0_amd64.deb',
      'Size: 3',
      `SHA256: ${sha('abc')}`,
      '',
    ].join('\n'),
  );
  // Not a real xz stream: the gz variant is preferred for the pool allow-list.
  const packagesXz = Buffer.from('xz-compressed Packages');
  const packagesGz = gzipSync(packagesPlain);
  const inRelease = [
    '-----BEGIN PGP SIGNED MESSAGE-----',
    'Origin: Debian',
    'Acquire-By-Hash: yes',
    'SHA256:',
    ` ${sha(packagesXz)} ${packagesXz.length} main/binary-amd64/Packages.xz`,
    ` ${sha(packagesGz)} ${packagesGz.length} main/binary-amd64/Packages.gz`,
    ` ${sha(packagesPlain)} ${packagesPlain.length} main/binary-amd64/Packages`,
    ` ${'1'.repeat(64)} 10 main/i18n/Translation-en`,
    ` ${'2'.repeat(64)} 10 contrib/binary-amd64/Packages.xz`,
    '-----BEGIN PGP SIGNATURE-----',
    'xyz',
  ].join('\n');
  const upstream: Record<string, Buffer> = {
    'https://deb.example/debian/dists/trixie/InRelease': Buffer.from(inRelease),
    'https://deb.example/debian/dists/trixie/main/binary-amd64/Packages.xz': packagesXz,
    'https://deb.example/debian/dists/trixie/main/binary-amd64/Packages.gz': packagesGz,
    'https://deb.example/debian/pool/main/b/bird2/bird2_2.17.5-0+deb13u1_amd64.deb': deb,
    'https://deb.example/debian/pool/main/e/evil/evil_1.0_amd64.deb': evilDeb,
    'https://deb.example/debian/pool/main/o/other/other_1.0_amd64.deb': Buffer.from('tampered'),
  };
  const requested: string[] = [];
  const fetchImpl = async (url: string) => {
    requested.push(url);

    return upstream[url] ? new Response(new Uint8Array(upstream[url])) : new Response('nope', { status: 404 });
  };
  const source = {
    name: 'debian-trixie',
    url: 'https://deb.example/debian',
    suites: ['trixie'],
    components: ['main'],
    arches: ['amd64'],
    keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
    os: 'debian:13',
  };

  it('parses InRelease and picks only the wanted, compressed indexes', () => {
    const checksums = releaseChecksums(inRelease);

    expect(checksums).toHaveLength(5);
    expect(acquireByHash(inRelease)).toBe(true);
    expect(indexFiles(checksums, ['main'], ['amd64']).map((f) => f.path)).toEqual([
      'main/binary-amd64/Packages.xz',
      'main/binary-amd64/Packages.gz',
    ]);
  });

  it('freezes the indexes and serves them as they were (also by hash), packages fetched once', async () => {
    const store = memoryStore();
    const files = await takeSnapshot([source], store, fetchImpl);
    const snapshot = { sources: [source], files };
    const pool = memoryPoolIndex();

    expect(Object.keys(files).sort()).toEqual([
      'debian-trixie/dists/trixie/InRelease',
      'debian-trixie/dists/trixie/main/binary-amd64/Packages.gz',
      'debian-trixie/dists/trixie/main/binary-amd64/Packages.xz',
    ]);

    // The upstream moves on; the snapshot doesn't.
    upstream['https://deb.example/debian/dists/trixie/InRelease'] = Buffer.from('changed');

    const index = await serveAptFile(snapshot, 'debian-trixie', 'dists/trixie/InRelease', store, pool, fetchImpl);

    expect((await read(index?.stream as Readable)).toString()).toBe(inRelease);

    const byHash = await serveAptFile(
      snapshot,
      'debian-trixie',
      `dists/trixie/main/binary-amd64/by-hash/SHA256/${sha(packagesXz)}`,
      store,
      pool,
      fetchImpl,
    );

    expect((await read(byHash?.stream as Readable)).equals(packagesXz)).toBe(true);

    const path = 'pool/main/b/bird2/bird2_2.17.5-0+deb13u1_amd64.deb';

    for (let i = 0; i < 2; i++) {
      const file = await serveAptFile(snapshot, 'debian-trixie', path, store, pool, fetchImpl);

      expect(file?.contentType).toBe('application/vnd.debian.binary-package');
      expect((await read(file?.stream as Readable)).equals(deb)).toBe(true);
    }

    expect(requested.filter((u) => u.endsWith('.deb'))).toHaveLength(1);
  });

  it('fetches only pool files the frozen indexes list, verified against size and SHA-256 (M6 review M3)', async () => {
    const store = memoryStore();

    upstream['https://deb.example/debian/dists/trixie/InRelease'] = Buffer.from(inRelease);

    const snapshot = { sources: [source], files: await takeSnapshot([source], store, fetchImpl) };
    const pool = memoryPoolIndex();
    const before = requested.length;

    // Not named by any frozen Packages index: refused without contacting the upstream (no open download proxy).
    expect(
      await serveAptFile(snapshot, 'debian-trixie', 'pool/main/e/evil/evil_1.0_amd64.deb', store, pool, fetchImpl),
    ).toBeNull();
    expect(requested.slice(before)).toEqual([]);

    // Listed, but the upstream bytes differ: refused, nothing stored or cached, retried on the next request.
    for (let i = 0; i < 2; i++)
      await expect(
        serveAptFile(snapshot, 'debian-trixie', 'pool/main/o/other/other_1.0_amd64.deb', store, pool, fetchImpl),
      ).rejects.toThrow(/larger than its index entry|does not match/);

    expect(requested.slice(before).filter((u) => u.endsWith('other_1.0_amd64.deb'))).toHaveLength(2);
    expect(await pool.get(source.url, 'pool/main/o/other/other_1.0_amd64.deb')).toBeNull();
    expect(store.blobs.has(sha('tampered'))).toBe(false);
  });

  it('refuses indexes that do not match InRelease, unknown sources and paths outside the archive', async () => {
    const store = memoryStore();
    const bad = async (url: string) => (url.endsWith('Packages.gz') ? new Response('tampered') : fetchImpl(url));

    upstream['https://deb.example/debian/dists/trixie/InRelease'] = Buffer.from(inRelease);
    await expect(takeSnapshot([source], store, bad)).rejects.toThrow(/does not match its InRelease checksum/);

    const snapshot = { sources: [source], files: {} };

    expect(
      await serveAptFile(snapshot, 'other', 'dists/trixie/InRelease', store, memoryPoolIndex(), fetchImpl),
    ).toBeNull();
    expect(
      await serveAptFile(snapshot, 'debian-trixie', 'dists/trixie/InRelease', store, memoryPoolIndex(), fetchImpl),
    ).toBeNull();

    for (const path of [
      '../etc/passwd',
      'pool/../../x.deb',
      'dists/trixie/main/../InRelease',
      'etc/passwd',
      'pool/main/x.sh',
    ])
      expect(classifyAptPath(path)).toBeNull();

    expect(classifyAptPath('dists/trixie-security/main/binary-arm64/Packages.xz')).toEqual({ kind: 'dist' });
  });

  it('parses Filename / Size / SHA256 of Packages stanzas', () => {
    expect([...parsePackagesIndex(packagesPlain.toString()).entries()]).toEqual([
      ['pool/main/b/bird2/bird2_2.17.5-0+deb13u1_amd64.deb', { sha256: sha(deb), size: deb.length }],
      ['pool/main/o/other/other_1.0_amd64.deb', { sha256: sha('abc'), size: 3 }],
    ]);
    expect(parsePackagesIndex('Package: x\nFilename: pool/x.deb\nSize: -1\nSHA256: zz\n').size).toBe(0);
  });

  it('derives sources per OS / architecture and validates overrides', () => {
    expect(defaultAptUpstreams('debian:13', 'amd64').map((u) => u.name)).toEqual([
      'debian-trixie',
      'debian-security-trixie',
      'docker-debian-trixie',
    ]);
    expect(defaultAptUpstreams('ubuntu:24.04', 'arm64')[0]).toMatchObject({
      url: 'http://ports.ubuntu.com/ubuntu-ports',
    });
    expect(defaultAptUpstreams('centos:9', 'amd64')).toEqual([]);
    expect(
      aptUpstreams(
        [
          { os: 'debian:13', arch: 'amd64' },
          { os: 'debian:13', arch: 'arm64' },
        ],
        undefined,
      )[0].arches,
    ).toEqual(['amd64', 'arm64']);
    expect(() => validateUpstream({ ...source, url: 'file:///etc' })).toThrow();
    expect(() => aptUpstreams([], JSON.stringify([{ ...source, suites: ['$(reboot)'] }]))).toThrow();
    expect(hostOs({ id: 'debian', versionId: '13' })).toBe('debian:13');
    expect(snapshotId(new Date('2026-10-19T12:34:56Z'), 'AbC-12')).toBe('s-20261019123456-abc12');
  });
});
