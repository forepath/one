import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { type ParseResult } from './common';
import { parseManifest, type AppManifest } from './manifest';

/** Media type of the package layer in an OCI app artifact. */
export const APP_PACKAGE_MEDIA_TYPE = 'application/vnd.loadweaver.app.v1+tar+gzip';

/** File names in a package archive, in archive order. */
export const PACKAGE_FILE_NAMES = ['README.md', 'compose.yaml', 'manifest.yaml'] as const;

/** Default cap on the uncompressed archive size when reading. */
export const MAX_PACKAGE_SIZE = 8 * 1024 * 1024;

/** The three files of a package. */
export interface PackageFiles {
  compose: string;
  manifest: string;
  readme: string;
}

/** A read and validated package. */
export interface LoadedPackage {
  files: PackageFiles;
  manifest: AppManifest;
  /** `sha256:<hex>` of the archive bytes. */
  digest: string;
}

const BLOCK = 512;
const FIELD_BY_NAME: Record<(typeof PACKAGE_FILE_NAMES)[number], keyof PackageFiles> = {
  'README.md': 'readme',
  'compose.yaml': 'compose',
  'manifest.yaml': 'manifest',
};

/** `sha256:<hex>` of some bytes (package archives, indexes, OCI manifests). */
export function sha256Digest(data: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

function writeString(header: Buffer, offset: number, length: number, value: string): void {
  header.write(value, offset, length, 'utf8');
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  writeString(header, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(BLOCK);

  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644); // mode
  writeOctal(header, 108, 8, 0); // uid
  writeOctal(header, 116, 8, 0); // gid
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0); // mtime: epoch
  header.fill(0x20, 148, 156); // checksum placeholder (spaces)
  writeString(header, 156, 1, '0'); // regular file
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, 'root');
  writeString(header, 297, 32, 'root');

  const checksum = header.reduce((sum, byte) => sum + byte, 0);

  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);

  return header;
}

function padding(size: number): Buffer {
  return Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);
}

/**
 * Builds a package archive (`tar.gz` of `README.md`, `compose.yaml`, `manifest.yaml`). Deterministic: sorted
 * entries, mode 0644, owner root (0/0), mtime 0, gzip header without name or time; the same files give the same
 * bytes (and digest) with the same zlib.
 */
export function buildPackageArchive(files: { [K in keyof PackageFiles]: string | Uint8Array }): Buffer {
  const parts: Buffer[] = [];

  for (const name of PACKAGE_FILE_NAMES) {
    const content = files[FIELD_BY_NAME[name]];
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);

    parts.push(tarHeader(name, data.length), data, padding(data.length));
  }

  parts.push(Buffer.alloc(BLOCK * 2));

  const gz = gzipSync(Buffer.concat(parts), { level: 9 });

  gz[9] = 3; // OS = Unix, whatever platform zlib was built for

  return gz;
}

function readString(block: Buffer, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);

  return raw.subarray(0, end < 0 ? length : end).toString('utf8');
}

function readOctal(block: Buffer, offset: number, length: number): number | null {
  const text = readString(block, offset, length).trim();

  return /^[0-7]+$/.test(text) ? parseInt(text, 8) : null;
}

/**
 * Reads a package archive back. Refuses anything but exactly the three package files as regular files (no links,
 * directories, path tricks, duplicates), bad tar checksums, and archives larger than `maxSize` uncompressed.
 */
export function readPackageArchive(archive: Uint8Array, options: { maxSize?: number } = {}): ParseResult<PackageFiles> {
  const maxSize = options.maxSize ?? MAX_PACKAGE_SIZE;
  let tar: Buffer;

  try {
    tar = gunzipSync(archive, { maxOutputLength: maxSize });
  } catch (error) {
    const message = (error as Error).message;

    return {
      ok: false,
      errors: [
        /maxOutputLength|buffer|Cannot create a Buffer/i.test(message) ||
        (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
          ? `the package is larger than ${maxSize} bytes uncompressed`
          : `the package is not a gzip archive: ${message}`,
      ],
    };
  }

  const found = new Map<string, string>();
  const errors: string[] = [];
  let offset = 0;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);

    if (header.every((b) => b === 0)) break;

    const expected = readOctal(header, 148, 8);
    const copy = Buffer.from(header);

    copy.fill(0x20, 148, 156);

    if (expected === null || copy.reduce((sum, byte) => sum + byte, 0) !== expected) {
      errors.push(`bad tar header checksum at offset ${offset}`);
      break;
    }

    const prefix = readString(header, 345, 155);
    const name = (prefix ? `${prefix}/` : '') + readString(header, 0, 100);
    const type = readString(header, 156, 1);
    const size = readOctal(header, 124, 12);

    if (size === null || offset + BLOCK + size > tar.length) {
      errors.push(`truncated or invalid entry ${name}`);
      break;
    }

    if (type !== '0' && type !== '') errors.push(`${name}: only regular files are allowed (type ${type})`);
    else if (!(PACKAGE_FILE_NAMES as readonly string[]).includes(name)) errors.push(`unexpected file ${name}`);
    else if (found.has(name)) errors.push(`duplicate file ${name}`);
    else found.set(name, tar.subarray(offset + BLOCK, offset + BLOCK + size).toString('utf8'));

    offset += BLOCK + size + ((BLOCK - (size % BLOCK)) % BLOCK);
  }

  for (const name of PACKAGE_FILE_NAMES) if (!found.has(name) && errors.length === 0) errors.push(`missing ${name}`);

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      readme: found.get('README.md') as string,
      compose: found.get('compose.yaml') as string,
      manifest: found.get('manifest.yaml') as string,
    },
  };
}

/**
 * Reads a package archive and parses its manifest; with `expected` also checks the archive digest (from the index)
 * and the app name / version the package was requested as.
 */
export function loadPackage(
  archive: Uint8Array,
  expected: { digest?: string; name?: string; version?: string } = {},
  options: { maxSize?: number } = {},
): ParseResult<LoadedPackage> {
  const digest = sha256Digest(archive);

  if (expected.digest !== undefined && expected.digest !== digest)
    return { ok: false, errors: [`package digest ${digest} does not match ${expected.digest}`] };

  const files = readPackageArchive(archive, options);

  if (files.ok === false) return files;

  const manifest = parseManifest(files.value.manifest);

  if (manifest.ok === false) return { ok: false, errors: manifest.errors.map((e) => `manifest.yaml: ${e}`) };

  const errors: string[] = [];

  if (expected.name !== undefined && manifest.value.name !== expected.name)
    errors.push(`the package is ${manifest.value.name}, expected ${expected.name}`);

  if (expected.version !== undefined && manifest.value.version !== expected.version)
    errors.push(`the package is version ${manifest.value.version}, expected ${expected.version}`);

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { files: files.value, manifest: manifest.value, digest } };
}
