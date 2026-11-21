import * as zlib from 'zlib';

import * as iconv from 'iconv-lite';

import { BankStatementParseError } from '../bank-import.types';

/**
 * In-memory ZIP reader for statement archives (banks commonly ship camt.053/054 as ZIP).
 *
 * Reads through the central directory, supports stored and deflate entries only and enforces size, count and
 * compression-ratio limits. Entry names are only used as labels: nothing is ever written to the filesystem.
 * Nested archives are returned as raw entries; the caller decides whether to open them (it should not recurse).
 */

export interface ZipLimits {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxEntryBytes: number;
  /** Maximum uncompressed:compressed ratio per entry. */
  maxCompressionRatio: number;
  /** Entries smaller than this are exempt from the ratio check (tiny files compress extremely well). */
  ratioCheckMinBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 500,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxEntryBytes: 50 * 1024 * 1024,
  maxCompressionRatio: 200,
  ratioCheckMinBytes: 64 * 1024,
};

export interface ZipEntry {
  /** Entry path as stored in the archive (control characters removed). A label only. */
  name: string;
  data: Buffer;
}

const SIG_LOCAL_HEADER = 0x04034b50;
const SIG_CENTRAL_HEADER = 0x02014b50;
const SIG_END_OF_CENTRAL_DIR = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** True for a ZIP local file header or an empty archive signature. */
export function isZip(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) || (buffer[2] === 0x05 && buffer[3] === 0x06))
  );
}

/** Extracts all file entries of a ZIP archive into memory, enforcing `limits`. */
export function readZipEntries(buffer: Buffer, limits: Partial<ZipLimits> = {}): ZipEntry[] {
  const cfg: ZipLimits = { ...DEFAULT_ZIP_LIMITS, ...limits };
  const eocd = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const centralDirDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralDirSize = buffer.readUInt32LE(eocd + 12);
  const centralDirOffset = buffer.readUInt32LE(eocd + 16);

  if (
    (eocd >= 20 && buffer.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR) ||
    totalEntries === 0xffff ||
    centralDirSize === 0xffffffff ||
    centralDirOffset === 0xffffffff
  ) {
    throw new BankStatementParseError('ZIP64 archives are not supported');
  }

  if (diskNumber !== 0 || centralDirDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new BankStatementParseError('Multi-volume ZIP archives are not supported');
  }

  if (totalEntries > cfg.maxEntries) {
    throw new BankStatementParseError(`ZIP archive has too many entries (${totalEntries} > ${cfg.maxEntries})`);
  }

  const centralDirEnd = centralDirOffset + centralDirSize;

  if (centralDirEnd > eocd) {
    throw new BankStatementParseError('Corrupt ZIP archive (central directory out of bounds)');
  }

  const entries: ZipEntry[] = [];
  const usedOffsets = new Set<number>();
  let totalBytes = 0;
  let p = centralDirOffset;

  for (let n = 0; n < totalEntries; n += 1) {
    if (p + 46 > centralDirEnd || buffer.readUInt32LE(p) !== SIG_CENTRAL_HEADER) {
      throw new BankStatementParseError('Corrupt ZIP archive (invalid central directory header)');
    }

    const flags = buffer.readUInt16LE(p + 8);
    const method = buffer.readUInt16LE(p + 10);
    const crc = buffer.readUInt32LE(p + 16);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const uncompressedSize = buffer.readUInt32LE(p + 24);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const nameEnd = p + 46 + nameLength;

    if (nameEnd > centralDirEnd) {
      throw new BankStatementParseError('Corrupt ZIP archive (entry name out of bounds)');
    }

    const rawName = buffer.subarray(p + 46, nameEnd);
    const name = sanitizeLabel((flags & FLAG_UTF8) !== 0 ? rawName.toString('utf8') : iconv.decode(rawName, 'cp437'));

    p = nameEnd + extraLength + commentLength;

    if (p > centralDirEnd) {
      throw new BankStatementParseError('Corrupt ZIP archive (central directory entry out of bounds)');
    }

    if (isIgnoredEntry(name)) {
      continue;
    }

    if ((flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0) {
      throw new BankStatementParseError('Encrypted ZIP entries are not supported', name);
    }

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new BankStatementParseError('ZIP64 archives are not supported', name);
    }

    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      throw new BankStatementParseError(`Unsupported ZIP compression method ${method}`, name);
    }

    if (uncompressedSize > cfg.maxEntryBytes) {
      throw new BankStatementParseError('ZIP entry exceeds the maximum uncompressed size', name);
    }

    if (totalBytes + uncompressedSize > cfg.maxTotalUncompressedBytes) {
      throw new BankStatementParseError('ZIP archive exceeds the maximum total uncompressed size', name);
    }

    assertRatio(uncompressedSize, compressedSize, cfg, name);

    if (usedOffsets.has(localOffset)) {
      throw new BankStatementParseError('Corrupt ZIP archive (overlapping entries)', name);
    }

    usedOffsets.add(localOffset);

    const compressed = readLocalData(buffer, localOffset, compressedSize, centralDirOffset, name);
    let data: Buffer;

    if (method === METHOD_STORED) {
      if (compressedSize !== uncompressedSize) {
        throw new BankStatementParseError('Corrupt ZIP entry (stored size mismatch)', name);
      }

      data = Buffer.from(compressed);
    } else {
      try {
        data = zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, uncompressedSize) });
      } catch {
        throw new BankStatementParseError('ZIP entry could not be inflated or exceeds its declared size', name);
      }
    }

    if (data.length !== uncompressedSize) {
      throw new BankStatementParseError('Corrupt ZIP entry (size mismatch)', name);
    }

    assertRatio(data.length, compressedSize, cfg, name);

    if (typeof zlib.crc32 === 'function' && zlib.crc32(data) >>> 0 !== crc >>> 0) {
      throw new BankStatementParseError('Corrupt ZIP entry (CRC mismatch)', name);
    }

    totalBytes += data.length;
    entries.push({ name, data });
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  if (buffer.length < EOCD_SIZE) {
    throw new BankStatementParseError('Not a ZIP archive');
  }

  const lowest = Math.max(0, buffer.length - EOCD_SIZE - MAX_COMMENT);

  for (let i = buffer.length - EOCD_SIZE; i >= lowest; i -= 1) {
    if (
      buffer.readUInt32LE(i) === SIG_END_OF_CENTRAL_DIR &&
      i + EOCD_SIZE + buffer.readUInt16LE(i + 20) <= buffer.length
    ) {
      return i;
    }
  }

  throw new BankStatementParseError('Not a ZIP archive (end of central directory not found)');
}

function readLocalData(
  buffer: Buffer,
  localOffset: number,
  compressedSize: number,
  centralDirOffset: number,
  name: string,
): Buffer {
  if (localOffset + 30 > centralDirOffset || buffer.readUInt32LE(localOffset) !== SIG_LOCAL_HEADER) {
    throw new BankStatementParseError('Corrupt ZIP archive (invalid local header)', name);
  }

  const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
  const end = start + compressedSize;

  if (end > centralDirOffset) {
    throw new BankStatementParseError('Corrupt ZIP archive (entry data out of bounds)', name);
  }

  return buffer.subarray(start, end);
}

function assertRatio(uncompressed: number, compressed: number, cfg: ZipLimits, name: string): void {
  if (uncompressed < cfg.ratioCheckMinBytes) {
    return;
  }

  if (uncompressed / Math.max(1, compressed) > cfg.maxCompressionRatio) {
    throw new BankStatementParseError('ZIP entry exceeds the maximum compression ratio (possible zip bomb)', name);
  }
}

/** Directories, macOS resource forks and dotfiles are skipped. */
function isIgnoredEntry(name: string): boolean {
  const normalized = name.replace(/\\/g, '/');

  if (normalized.endsWith('/')) {
    return true;
  }

  if (normalized.startsWith('__MACOSX/') || normalized.includes('/__MACOSX/')) {
    return true;
  }

  const base = normalized.slice(normalized.lastIndexOf('/') + 1);

  return base.length === 0 || base.startsWith('.');
}

function sanitizeLabel(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]/g, '');
}
