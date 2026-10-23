import { createHash, createPublicKey, verify } from 'node:crypto';

/** Reads from one image repository: manifests by tag / digest, blobs by digest. */
export interface RepositoryReader {
  /** `accept`: manifest media types to accept (default: an OCI image manifest); image inspection asks for indexes too. */
  manifest(
    reference: string,
    accept?: string,
  ): Promise<({ mediaType?: string; layers?: OciDescriptor[] } & Record<string, unknown>) | null>;
  blob(digest: string): Promise<Buffer>;
  /** The first `bytes` of a (large) blob, e.g. a layer's first tar headers; readers without it can't peek into layers. */
  blobPrefix?(digest: string, bytes: number): Promise<Buffer>;
}

export interface OciDescriptor {
  mediaType: string;
  digest: string;
  size: number;
  annotations?: Record<string, string>;
}

const SIMPLE_SIGNING = 'application/vnd.dev.cosign.simplesigning.v1+json';
const SIGNATURE_ANNOTATION = 'dev.cosignproject.cosign/signature';
const MAX_PAYLOAD_BYTES = 64 * 1024;

/** cosign's tag for the signatures of a digest: `sha256-<hex>.sig`. */
export function signatureTag(digest: string): string {
  return `${digest.replace(':', '-')}.sig`;
}

/**
 * Verifies cosign signatures (classic simple-signing, key-based) of an image digest (3.22): a signature layer counts
 * when its payload blob matches its digest, names exactly this image digest, and its signature verifies with one of
 * the keys. Returns which key index verified, or why nothing did.
 */
export async function verifyCosignSignature(
  reader: RepositoryReader,
  digest: string,
  publicKeysPem: readonly string[],
): Promise<{ verified: true; key: number } | { verified: false; reason: string }> {
  const manifest = await reader.manifest(signatureTag(digest)).catch(() => null);

  if (!manifest?.layers?.length) return { verified: false, reason: 'no cosign signature found' };

  const keys = publicKeysPem.map((pem) => createPublicKey(pem));
  let reason = 'no signature verifies with the policy keys';

  for (const layer of manifest.layers) {
    const signature = layer.annotations?.[SIGNATURE_ANNOTATION];

    if (layer.mediaType !== SIMPLE_SIGNING || !signature || layer.size > MAX_PAYLOAD_BYTES) continue;

    let payload: Buffer;

    try {
      payload = await reader.blob(layer.digest);
    } catch {
      reason = 'signature payload not readable';
      continue;
    }

    if (`sha256:${createHash('sha256').update(payload).digest('hex')}` !== layer.digest) {
      reason = 'signature payload does not match its digest';
      continue;
    }

    let signed: { critical?: { image?: { 'docker-manifest-digest'?: string } } };

    try {
      signed = JSON.parse(payload.toString('utf8'));
    } catch {
      continue;
    }

    if (signed.critical?.image?.['docker-manifest-digest'] !== digest) {
      reason = 'signature is for another image';
      continue;
    }

    const index = keys.findIndex((key) => {
      try {
        return verify('sha256', payload, key, Buffer.from(signature, 'base64'));
      } catch {
        return false;
      }
    });

    if (index >= 0) return { verified: true, key: index };
  }

  return { verified: false, reason };
}
