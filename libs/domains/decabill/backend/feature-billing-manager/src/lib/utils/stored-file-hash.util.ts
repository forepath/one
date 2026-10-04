import { createHash } from 'node:crypto';

/** Stable full file reference hash (sha1 of registry id), ticket-style. */
export function deriveStoredFileLongSha(fileId: string): string {
  return createHash('sha1').update(fileId).digest('hex');
}

export function shortShaFromLong(longSha: string): string {
  return longSha.slice(0, 7);
}

export interface StoredFileContentHashes {
  md5: string;
  sha1: string;
  sha256: string;
  sha512: string;
  byteSize: number;
}

export function computeStoredFileContentHashes(content: Buffer): StoredFileContentHashes {
  return {
    md5: createHash('md5').update(content).digest('hex'),
    sha1: createHash('sha1').update(content).digest('hex'),
    sha256: createHash('sha256').update(content).digest('hex'),
    sha512: createHash('sha512').update(content).digest('hex'),
    byteSize: content.byteLength,
  };
}
