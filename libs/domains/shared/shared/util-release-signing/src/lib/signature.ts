import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

import { z } from 'zod';

/**
 * Release signatures: ECDSA P-256 with SHA-256 over a document's canonical JSON bytes (`canonicalJson`), DER-encoded
 * and base64'd, named by a key id. The private key exists only as a CI secret held by the product owner; verifiers
 * trust a set of public keys (PEM) compiled into the product or its release tooling (`resolveTrustedReleaseKeys`).
 * Every key set is pluggable: nothing in here knows a product or a key.
 */
export const RELEASE_SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256';

export const releaseSignatureSchema = z
  .object({
    algorithm: z.literal(RELEASE_SIGNATURE_ALGORITHM),
    /** First 16 hex characters of the SHA-256 of the public key (SPKI DER). */
    keyId: z.string().regex(/^[0-9a-f]{16}$/),
    signature: z
      .string()
      .max(200)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export type ReleaseSignature = z.infer<typeof releaseSignatureSchema>;

function publicKey(pem: string): KeyObject {
  const key = createPublicKey(pem);

  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new Error('release keys are ECDSA P-256 keys');

  return key;
}

/** Key id of a public key (PEM): what a signature names, so the verifier tries the right key first. */
export function releaseKeyId(publicKeyPem: string): string {
  return createHash('sha256')
    .update(publicKey(publicKeyPem).export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);
}

/** Signs the canonical manifest bytes (CI, tests). The key never leaves the caller. */
export function signManifest(manifestBytes: Uint8Array, privateKeyPem: string): ReleaseSignature {
  const key = createPrivateKey(privateKeyPem);

  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new Error('the release signing key must be an ECDSA P-256 key');

  const publicPem = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();

  return {
    algorithm: RELEASE_SIGNATURE_ALGORITHM,
    keyId: releaseKeyId(publicPem),
    signature: sign('sha256', manifestBytes, key).toString('base64'),
  };
}

export type SignatureCheck = { ok: true; keyId: string } | { ok: false; reason: string };

/** Verifies a signature over the manifest bytes against the trusted public keys (PEM). */
export function verifyManifestSignature(
  manifestBytes: Uint8Array,
  signature: unknown,
  trustedKeysPem: readonly string[],
): SignatureCheck {
  const parsed = releaseSignatureSchema.safeParse(signature);

  if (!parsed.success) return { ok: false, reason: 'the signature document is malformed' };

  if (trustedKeysPem.length === 0) return { ok: false, reason: 'no release signing key is trusted by this build' };

  const der = Buffer.from(parsed.data.signature, 'base64');
  // The named key first; every trusted key is tried (a key id is a hint, not a trust decision).
  const keys = [...trustedKeysPem].sort((a, b) =>
    releaseKeyId(a) === parsed.data.keyId ? -1 : releaseKeyId(b) === parsed.data.keyId ? 1 : 0,
  );

  for (const pem of keys) {
    try {
      if (verify('sha256', manifestBytes, publicKey(pem), der)) return { ok: true, keyId: releaseKeyId(pem) };
    } catch {
      // malformed signature or key: try the next key
    }
  }

  return { ok: false, reason: 'the signature does not verify with any trusted release key' };
}

/** A new signing key pair (key-generation targets); the private half belongs into the CI secret only. */
export function generateReleaseKeyPair(): { publicKeyPem: string; privateKeyPem: string; keyId: string } {
  const { publicKey: pub, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyPem = pub.export({ type: 'spki', format: 'pem' }).toString();

  return {
    publicKeyPem,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    keyId: releaseKeyId(publicKeyPem),
  };
}
