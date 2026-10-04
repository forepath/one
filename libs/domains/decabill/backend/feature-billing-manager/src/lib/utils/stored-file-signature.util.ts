import { createHmac, timingSafeEqual } from 'node:crypto';

export const STORED_FILE_SIGNATURE_ALG = 'hmac-sha256';
export const STORED_FILE_SIGNATURE_VERSION = 'v1';

export interface StoredFileSignatureEnvelopeParts {
  tenantId: string;
  scope: string;
  storageKey: string;
  contentMd5: string;
  contentSha1: string;
  contentSha256: string;
  contentSha512: string;
  byteSize: number | string;
  registryFileId: string;
}

export function buildStoredFileSignatureEnvelopeV1(parts: StoredFileSignatureEnvelopeParts): string {
  return [
    STORED_FILE_SIGNATURE_VERSION,
    parts.tenantId,
    parts.scope,
    parts.storageKey.replace(/\\/g, '/'),
    parts.contentMd5,
    parts.contentSha1,
    parts.contentSha256,
    parts.contentSha512,
    String(parts.byteSize),
    parts.registryFileId,
  ].join('\n');
}

export function signStoredFileV1(secret: string, parts: StoredFileSignatureEnvelopeParts): string {
  const envelope = buildStoredFileSignatureEnvelopeV1(parts);

  return createHmac('sha256', secret).update(envelope, 'utf8').digest('hex');
}

export function verifyStoredFileV1(
  secret: string,
  parts: StoredFileSignatureEnvelopeParts,
  signatureHex: string,
): boolean {
  const expected = signStoredFileV1(secret, parts);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signatureHex, 'utf8');

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, actualBuf);
}
