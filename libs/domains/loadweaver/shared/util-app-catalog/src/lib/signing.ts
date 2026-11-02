import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

import { parseIndex, type CatalogAppVersion, type CatalogIndex } from './catalog-index';
import { DIGEST_PATTERN, isRecord, type ParseResult } from './common';
import { APP_PACKAGE_MEDIA_TYPE, sha256Digest } from './package-archive';

/** Key types the app store signs and verifies with (cosign key-based). */
export type SigningKeyType = 'ecdsa-p256' | 'ed25519';

/** `type` of cosign's simple-signing payload. */
export const SIMPLE_SIGNING_TYPE = 'cosign container image signature';
/** Media type of the simple-signing payload layer in a cosign signature artifact. */
export const SIMPLE_SIGNING_MEDIA_TYPE = 'application/vnd.dev.cosign.simplesigning.v1+json';
/** Layer annotation carrying the base64 signature in a cosign signature artifact. */
export const COSIGN_SIGNATURE_ANNOTATION = 'dev.cosignproject.cosign/signature';
/** Media type of the index layer in the OCI index artifact (`<catalog>:index`). */
export const APP_INDEX_MEDIA_TYPE = 'application/vnd.loadweaver.app-index.v1+yaml';
export const OCI_MANIFEST_MEDIA_TYPE = 'application/vnd.oci.image.manifest.v1+json';
/** The OCI empty config descriptor (`{}`), used for artifacts. */
export const OCI_EMPTY_CONFIG = {
  mediaType: 'application/vnd.oci.empty.v1+json',
  digest: 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  size: 2,
} as const;

function keyTypeOf(key: KeyObject): SigningKeyType | null {
  if (key.asymmetricKeyType === 'ed25519') return 'ed25519';

  if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') return 'ecdsa-p256';

  return null;
}

function publicKeyObject(publicKey: string | KeyObject): KeyObject {
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
  const usable = key.type === 'private' ? createPublicKey(key) : key;

  if (!keyTypeOf(usable)) throw new Error('app store keys are ECDSA P-256 or Ed25519 keys');

  return usable;
}

/** Key id of a public key (PEM or key object; a private key is reduced to its public key): SHA-256 hex of the SPKI DER. */
export function publicKeyId(publicKey: string | KeyObject): string {
  return createHash('sha256')
    .update(publicKeyObject(publicKey).export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

/** The key type of a PEM public key, or `null` when it is no ECDSA P-256 / Ed25519 key (or no key at all). */
export function signingKeyType(publicKeyPem: string): SigningKeyType | null {
  try {
    return keyTypeOf(createPublicKey(publicKeyPem));
  } catch {
    return null;
  }
}

export interface SigningKeyPair {
  type: SigningKeyType;
  /** PKCS#8 PEM; never commit or log it. */
  privateKeyPem: string;
  /** SPKI PEM (what catalogs and clusters register). */
  publicKeyPem: string;
  keyId: string;
}

/** Generates a signing key pair (`lw app keygen`, tests). */
export function generateSigningKeyPair(type: SigningKeyType = 'ecdsa-p256'): SigningKeyPair {
  const { privateKey, publicKey } =
    type === 'ed25519' ? generateKeyPairSync('ed25519') : generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

  return {
    type,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: publicKeyId(publicKey),
  };
}

/**
 * Signs bytes like `cosign sign-blob --key`: ECDSA P-256 over SHA-256 (DER signature) or pure Ed25519; returns the
 * base64 signature (the `.sig` file content). The key is a PKCS#8 / SEC1 PEM private key (optionally
 * passphrase-encrypted PKCS#8). cosign's own `ENCRYPTED SIGSTORE PRIVATE KEY` format is not read: generate the key
 * here or with openssl (`cosign import-key-pair` takes it into cosign), or sign with cosign directly; cosign
 * signatures verify here either way.
 */
export function signBlob(data: Uint8Array, privateKeyPem: string, passphrase?: string): string {
  const key = createPrivateKey(passphrase === undefined ? privateKeyPem : { key: privateKeyPem, passphrase });
  const type = keyTypeOf(key);

  if (!type) throw new Error('app store signing keys are ECDSA P-256 or Ed25519 keys');

  return sign(type === 'ed25519' ? null : 'sha256', data, key).toString('base64');
}

/**
 * Verifies a cosign `sign-blob` signature (base64, surrounding whitespace ignored) over bytes against public keys
 * (PEM). Keys of other types or malformed keys are skipped. Returns the id of the key that matched.
 */
export function verifyBlob(
  data: Uint8Array,
  signature: string,
  publicKeys: readonly string[],
): ParseResult<{ keyId: string }> {
  const text = signature.trim();

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0)
    return { ok: false, errors: ['the signature is not base64'] };

  if (publicKeys.length === 0) return { ok: false, errors: ['no public key to verify against'] };

  const raw = Buffer.from(text, 'base64');

  for (const pem of publicKeys) {
    let key: KeyObject;

    try {
      key = publicKeyObject(pem);
    } catch {
      continue;
    }

    try {
      if (verify(keyTypeOf(key) === 'ed25519' ? null : 'sha256', data, key, raw))
        return { ok: true, value: { keyId: publicKeyId(key) } };
    } catch {
      // Malformed signature for this key type: try the next key.
    }
  }

  return { ok: false, errors: ['the signature does not match any trusted key'] };
}

/** cosign's simple-signing payload. */
export interface SimpleSigningPayload {
  critical: {
    identity: { 'docker-reference': string };
    image: { 'docker-manifest-digest': string };
    type: string;
  };
  optional: Record<string, unknown> | null;
}

/** Builds cosign's simple-signing payload bytes (what `cosign sign --key` signs for an image / artifact). */
export function buildSimpleSigningPayload(input: {
  /** Repository the artifact lives in (`registry/repo`; tags / digests are stripped). */
  dockerReference: string;
  manifestDigest: string;
  optional?: Record<string, unknown>;
}): Buffer {
  if (!DIGEST_PATTERN.test(input.manifestDigest)) throw new Error('manifestDigest must be sha256:<64 hex>');

  const payload: SimpleSigningPayload = {
    critical: {
      identity: { 'docker-reference': repositoryOf(input.dockerReference) },
      image: { 'docker-manifest-digest': input.manifestDigest },
      type: SIMPLE_SIGNING_TYPE,
    },
    optional: input.optional ?? null,
  };

  return Buffer.from(JSON.stringify(payload), 'utf8');
}

/** `registry/repo` without `:tag` / `@digest` (and without an `oci://` scheme). */
function repositoryOf(reference: string): string {
  const withoutScheme = reference.replace(/^oci:\/\//, '');
  const withoutDigest = withoutScheme.split('@')[0];
  const slash = withoutDigest.lastIndexOf('/');
  const colon = withoutDigest.lastIndexOf(':');

  return colon > slash ? withoutDigest.slice(0, colon) : withoutDigest;
}

/** Parses simple-signing payload bytes (structure only; no signature check). */
export function parseSimpleSigningPayload(payload: Uint8Array): ParseResult<SimpleSigningPayload> {
  let raw: unknown;

  try {
    raw = JSON.parse(Buffer.from(payload).toString('utf8'));
  } catch {
    return { ok: false, errors: ['the simple-signing payload is not JSON'] };
  }

  const critical = isRecord(raw) ? raw['critical'] : undefined;
  const identity = isRecord(critical) ? critical['identity'] : undefined;
  const image = isRecord(critical) ? critical['image'] : undefined;

  if (
    !isRecord(raw) ||
    !isRecord(critical) ||
    !isRecord(identity) ||
    !isRecord(image) ||
    typeof identity['docker-reference'] !== 'string' ||
    typeof image['docker-manifest-digest'] !== 'string' ||
    critical['type'] !== SIMPLE_SIGNING_TYPE
  )
    return { ok: false, errors: ['the payload is not a cosign simple-signing payload'] };

  return {
    ok: true,
    value: {
      critical: {
        identity: { 'docker-reference': identity['docker-reference'] },
        image: { 'docker-manifest-digest': image['docker-manifest-digest'] },
        type: SIMPLE_SIGNING_TYPE,
      },
      optional: isRecord(raw['optional']) ? raw['optional'] : null,
    },
  };
}

/**
 * Verifies a cosign simple-signing signature: the signature over the payload bytes, then the payload's manifest
 * digest (and repository, when given) against what was pulled.
 */
export function verifySimpleSigning(
  payload: Uint8Array,
  signature: string,
  publicKeys: readonly string[],
  expected: { manifestDigest: string; dockerReference?: string },
): ParseResult<{ keyId: string; payload: SimpleSigningPayload }> {
  const verified = verifyBlob(payload, signature, publicKeys);

  if (verified.ok === false) return verified;

  const parsed = parseSimpleSigningPayload(payload);

  if (parsed.ok === false) return parsed;

  const critical = parsed.value.critical;

  if (critical.image['docker-manifest-digest'] !== expected.manifestDigest)
    return {
      ok: false,
      errors: [`the signature is for ${critical.image['docker-manifest-digest']}, not ${expected.manifestDigest}`],
    };

  if (
    expected.dockerReference !== undefined &&
    repositoryOf(critical.identity['docker-reference']) !== repositoryOf(expected.dockerReference)
  )
    return {
      ok: false,
      errors: [
        `the signature is for ${critical.identity['docker-reference']}, not ${repositoryOf(expected.dockerReference)}`,
      ],
    };

  return { ok: true, value: { keyId: verified.value.keyId, payload: parsed.value } };
}

/** Tag of an artifact's cosign signature (`sha256-<hex>.sig`). */
export function cosignSignatureTag(manifestDigest: string): string {
  if (!DIGEST_PATTERN.test(manifestDigest)) throw new Error('manifestDigest must be sha256:<64 hex>');

  return `${manifestDigest.replace(':', '-')}.sig`;
}

/** Builds an OCI artifact manifest with one layer (package or index) and the empty config. */
export function buildOciArtifactManifest(input: {
  layer: Uint8Array;
  layerMediaType: string;
  artifactType?: string;
  annotations?: Record<string, string>;
}): { manifest: Buffer; digest: string } {
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: OCI_MANIFEST_MEDIA_TYPE,
      ...(input.artifactType ? { artifactType: input.artifactType } : {}),
      config: OCI_EMPTY_CONFIG,
      layers: [{ mediaType: input.layerMediaType, digest: sha256Digest(input.layer), size: input.layer.length }],
      ...(input.annotations ? { annotations: input.annotations } : {}),
    }),
    'utf8',
  );

  return { manifest, digest: sha256Digest(manifest) };
}

/** The first layer of an OCI manifest with a media type. */
export function findOciLayer(manifest: Uint8Array, mediaType: string): { digest: string; size: number } | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(manifest).toString('utf8'));
    const layers = isRecord(parsed) && Array.isArray(parsed['layers']) ? parsed['layers'] : [];
    const layer = layers.find((l: unknown) => isRecord(l) && l['mediaType'] === mediaType) as
      | Record<string, unknown>
      | undefined;

    return layer && typeof layer['digest'] === 'string' && typeof layer['size'] === 'number'
      ? { digest: layer['digest'], size: layer['size'] }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * How a package or index was signed: `blob` (Git catalogs: the `.sig` file next to it) or `oci` (the artifact's OCI
 * manifest bytes plus the cosign simple-signing payload and signature from its `.sig` artifact).
 */
export type DetachedSignature =
  | { kind: 'blob'; signature: string }
  | { kind: 'oci'; manifest: Uint8Array; payload: Uint8Array; signature: string; dockerReference?: string };

/**
 * Verifies signed content (package archive or index bytes) with either signature kind. For `oci`, the manifest must
 * carry the content as a layer of `layerMediaType`, and the simple-signing payload must name that manifest's digest.
 */
export function verifySignedContent(
  content: Uint8Array,
  signature: DetachedSignature,
  publicKeys: readonly string[],
  layerMediaType: string,
): ParseResult<{ keyId: string }> {
  if (signature.kind === 'blob') return verifyBlob(content, signature.signature, publicKeys);

  const layer = findOciLayer(signature.manifest, layerMediaType);

  if (!layer) return { ok: false, errors: [`the OCI manifest has no ${layerMediaType} layer`] };

  const digest = sha256Digest(content);

  if (layer.digest !== digest || layer.size !== content.length)
    return { ok: false, errors: [`the OCI manifest's layer ${layer.digest} is not the content ${digest}`] };

  const verified = verifySimpleSigning(signature.payload, signature.signature, publicKeys, {
    manifestDigest: sha256Digest(signature.manifest),
    dockerReference: signature.dockerReference,
  });

  return verified.ok === true ? { ok: true, value: { keyId: verified.value.keyId } } : verified;
}

/**
 * Verifies an index against the catalog key(s) and only then parses it. Also checks that every publisher entry's
 * key is an ECDSA P-256 / Ed25519 key whose id is its `publishers` key.
 */
export function verifyIndex(
  indexBytes: Uint8Array,
  signature: DetachedSignature,
  catalogKeys: readonly string[],
): ParseResult<{ index: CatalogIndex; keyId: string }> {
  const verified = verifySignedContent(indexBytes, signature, catalogKeys, APP_INDEX_MEDIA_TYPE);

  if (verified.ok === false) return { ok: false, errors: verified.errors.map((e) => `index.yaml: ${e}`) };

  const parsed = parseIndex(indexBytes);

  if (parsed.ok === false) return parsed;

  const errors: string[] = [];

  for (const [keyId, publisher] of Object.entries(parsed.value.publishers)) {
    let actual: string;

    try {
      actual = publicKeyId(publisher.publicKey);
    } catch (error) {
      errors.push(`publishers.${keyId}: ${(error as Error).message}`);
      continue;
    }

    if (actual !== keyId) errors.push(`publishers.${keyId}: the public key's id is ${actual}`);
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { index: parsed.value, keyId: verified.value.keyId } };
}

/**
 * Verifies a package against a verified index: the app version must be listed, the archive must have the listed
 * digest, and the signature must be made by one of the app's publisher's keys (by publisher name). Takedowns are not
 * checked here (see `findTakedown`).
 */
export function verifyPackage(input: {
  index: CatalogIndex;
  app: string;
  version: string;
  archive: Uint8Array;
  signature: DetachedSignature;
}): ParseResult<{ keyId: string; publisher: string; version: CatalogAppVersion }> {
  const app = input.index.apps.find((a) => a.name === input.app);
  const version = app?.versions.find((v) => v.version === input.version);

  if (!app || !version) return { ok: false, errors: [`${input.app} ${input.version} is not in the catalog index`] };

  const digest = sha256Digest(input.archive);

  if (digest !== version.digest)
    return { ok: false, errors: [`package digest ${digest} does not match the index (${version.digest})`] };

  const keys = Object.entries(input.index.publishers)
    .filter(([keyId, p]) => {
      if (p.name !== app.publisher) return false;

      try {
        return publicKeyId(p.publicKey) === keyId;
      } catch {
        return false;
      }
    })
    .map(([, p]) => p.publicKey);

  if (keys.length === 0) return { ok: false, errors: [`publisher ${app.publisher} has no valid key in the index`] };

  const verified = verifySignedContent(input.archive, input.signature, keys, APP_PACKAGE_MEDIA_TYPE);

  return verified.ok === true
    ? { ok: true, value: { keyId: verified.value.keyId, publisher: app.publisher, version } }
    : { ok: false, errors: verified.errors.map((e) => `${input.app} ${input.version}: ${e}`) };
}
