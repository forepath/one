import {
  signStoredFileV1,
  verifyStoredFileV1,
  type StoredFileSignatureEnvelopeParts,
} from './stored-file-signature.util';

const baseParts: StoredFileSignatureEnvelopeParts = {
  tenantId: 'default',
  scope: 'customerInvoices',
  storageKey: 'sub-1/inv.pdf',
  contentMd5: 'm'.repeat(32),
  contentSha1: 'a'.repeat(40),
  contentSha256: 'b'.repeat(64),
  contentSha512: 'c'.repeat(128),
  byteSize: 12,
  registryFileId: '11111111-1111-1111-1111-111111111111',
};

describe('stored-file-signature.util', () => {
  const secret = 'test-signing-secret';

  it('signs and verifies a valid envelope', () => {
    const signature = signStoredFileV1(secret, baseParts);

    expect(signature).toHaveLength(64);
    expect(verifyStoredFileV1(secret, baseParts, signature)).toBe(true);
  });

  it('fails when tenant differs', () => {
    const signature = signStoredFileV1(secret, baseParts);

    expect(verifyStoredFileV1(secret, { ...baseParts, tenantId: 'other' }, signature)).toBe(false);
  });

  it('fails when content digest differs', () => {
    const signature = signStoredFileV1(secret, baseParts);

    expect(verifyStoredFileV1(secret, { ...baseParts, contentSha256: 'd'.repeat(64) }, signature)).toBe(false);
  });
});
