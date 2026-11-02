import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { COMPOSE_YAML, MANIFEST_YAML, README } from './__fixtures__/fixtures';
import { buildPackageArchive, loadPackage, readPackageArchive, sha256Digest } from './package-archive';

const FILES = { compose: COMPOSE_YAML, manifest: MANIFEST_YAML, readme: README };

/** A raw ustar entry (test helper for hostile archives). */
function tarEntry(name: string, data: string, type = '0'): Buffer {
  const header = Buffer.alloc(512);
  const body = Buffer.from(data);

  header.write(name, 0, 100);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1);
  header.write('ustar\0', 257);
  header.write('00', 263);
  header.write(
    `${header
      .reduce((s, b) => s + b, 0)
      .toString(8)
      .padStart(6, '0')}\0 `,
    148,
  );

  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

function tarGz(...entries: Buffer[]): Buffer {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

const VALID_ENTRIES = () => [
  tarEntry('README.md', README),
  tarEntry('compose.yaml', COMPOSE_YAML),
  tarEntry('manifest.yaml', MANIFEST_YAML),
];

describe('package archive', () => {
  it('round-trips the three files', () => {
    const result = readPackageArchive(buildPackageArchive(FILES));

    expect(result).toEqual({ ok: true, value: FILES });
  });

  it('accepts bytes as input', () => {
    const archive = buildPackageArchive({
      compose: Buffer.from(COMPOSE_YAML),
      manifest: Buffer.from(MANIFEST_YAML),
      readme: new Uint8Array(Buffer.from(README)),
    });

    expect(archive.equals(buildPackageArchive(FILES))).toBe(true);
  });

  it('is deterministic: same files, same bytes and digest', () => {
    const a = buildPackageArchive(FILES);
    const b = buildPackageArchive({ ...FILES });

    expect(a.equals(b)).toBe(true);
    expect(sha256Digest(a)).toBe(sha256Digest(b));
    expect(sha256Digest(buildPackageArchive({ ...FILES, readme: `${README} ` }))).not.toBe(sha256Digest(a));
  });

  it('writes sorted entries with fixed mode, owner and mtime and a time-less gzip header', () => {
    const archive = buildPackageArchive(FILES);

    expect([...archive.subarray(0, 10)]).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 3]);

    const tar = gunzipSync(archive);
    const names: string[] = [];

    for (let offset = 0; offset < tar.length && tar[offset] !== 0; ) {
      const header = tar.subarray(offset, offset + 512);
      const size = parseInt(header.subarray(124, 135).toString(), 8);

      names.push(header.subarray(0, 100).toString().replace(/\0+$/, ''));
      expect(header.subarray(100, 107).toString()).toBe('0000644');
      expect(header.subarray(108, 115).toString()).toBe('0000000');
      expect(header.subarray(136, 147).toString()).toBe('00000000000');
      offset += 512 + Math.ceil(size / 512) * 512;
    }

    expect(names).toEqual(['README.md', 'compose.yaml', 'manifest.yaml']);
  });

  it('is readable by a standard tar implementation layout (ustar magic, valid checksum)', () => {
    expect(readPackageArchive(tarGz(...VALID_ENTRIES())).ok).toBe(true);
  });

  it('computes sha256 digests', () => {
    expect(sha256Digest('abc')).toBe(`sha256:${createHash('sha256').update('abc').digest('hex')}`);
  });

  it.each([
    ['an extra file', [...VALID_ENTRIES(), tarEntry('evil.sh', 'x')], /unexpected file evil.sh/],
    ['a path traversal', [...VALID_ENTRIES(), tarEntry('../compose.yaml', 'x')], /unexpected file \.\.\/compose.yaml/],
    ['a symlink', [tarEntry('README.md', '', '2'), ...VALID_ENTRIES().slice(1)], /only regular files/],
    ['a directory', [tarEntry('dir/', '', '5'), ...VALID_ENTRIES()], /only regular files/],
    ['a duplicate', [...VALID_ENTRIES(), tarEntry('compose.yaml', 'x')], /duplicate file compose.yaml/],
    ['a missing file', VALID_ENTRIES().slice(0, 2), /missing manifest.yaml/],
  ])('refuses %s', (_, entries, error) => {
    const result = readPackageArchive(tarGz(...entries));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join('\n')).toMatch(error);
  });

  it('refuses a corrupted header (checksum)', () => {
    const tar = Buffer.concat([...VALID_ENTRIES(), Buffer.alloc(1024)]);

    tar[0] = 'X'.charCodeAt(0);

    const result = readPackageArchive(gzipSync(tar));

    expect(!result.ok && result.errors[0]).toMatch(/bad tar header checksum/);
  });

  it('refuses non-gzip data and tampered gzip', () => {
    expect(!readPackageArchive(Buffer.from('not gzip')).ok).toBe(true);

    const archive = Buffer.from(buildPackageArchive(FILES));

    archive[archive.length - 10] ^= 0xff;
    expect(readPackageArchive(archive).ok).toBe(false);
  });

  it('refuses archives larger than the limit', () => {
    const result = readPackageArchive(buildPackageArchive({ ...FILES, readme: 'x'.repeat(100_000) }), {
      maxSize: 50_000,
    });

    expect(!result.ok && result.errors).toEqual(['the package is larger than 50000 bytes uncompressed']);
  });
});

describe('loadPackage', () => {
  const archive = buildPackageArchive(FILES);

  it('reads, parses and digests a package', () => {
    const result = loadPackage(archive, { digest: sha256Digest(archive), name: 'wiki', version: '1.2.0' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.manifest.name).toBe('wiki');
    expect(result.ok && result.value.digest).toBe(sha256Digest(archive));
  });

  it('refuses a digest, name or version mismatch', () => {
    expect(loadPackage(archive, { digest: `sha256:${'0'.repeat(64)}` }).ok).toBe(false);
    expect(!loadPackage(archive, { name: 'other', version: '2.0.0' }).ok).toBe(true);

    const result = loadPackage(archive, { name: 'other', version: '2.0.0' });

    expect(!result.ok && result.errors).toEqual([
      'the package is wiki, expected other',
      'the package is version 1.2.0, expected 2.0.0',
    ]);
  });

  it('prefixes manifest errors', () => {
    const result = loadPackage(buildPackageArchive({ ...FILES, manifest: 'apiVersion: x' }));

    expect(!result.ok && result.errors[0]).toMatch(/^manifest.yaml: /);
  });
});
