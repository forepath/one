import { computeStoredFileContentHashes, deriveStoredFileLongSha, shortShaFromLong } from './stored-file-hash.util';

describe('stored-file-hash.util', () => {
  it('derives stable long sha and short prefix', () => {
    const long = deriveStoredFileLongSha('11111111-1111-1111-1111-111111111111');

    expect(long).toHaveLength(40);
    expect(shortShaFromLong(long)).toBe(long.slice(0, 7));
    expect(deriveStoredFileLongSha('11111111-1111-1111-1111-111111111111')).toBe(long);
  });

  it('computes content digests from buffer', () => {
    const hashes = computeStoredFileContentHashes(Buffer.from('hello'));

    expect(hashes.byteSize).toBe(5);
    expect(hashes.md5).toHaveLength(32);
    expect(hashes.sha1).toHaveLength(40);
    expect(hashes.sha256).toHaveLength(64);
    expect(hashes.sha512).toHaveLength(128);
  });
});
