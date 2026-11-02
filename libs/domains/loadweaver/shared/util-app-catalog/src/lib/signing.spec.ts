import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';

import { stringify } from 'yaml';

import { COMPOSE_YAML, MANIFEST_YAML, README } from './__fixtures__/fixtures';
import { APP_PACKAGE_MEDIA_TYPE, buildPackageArchive, sha256Digest } from './package-archive';
import {
  APP_INDEX_MEDIA_TYPE,
  buildOciArtifactManifest,
  buildSimpleSigningPayload,
  cosignSignatureTag,
  findOciLayer,
  generateSigningKeyPair,
  OCI_EMPTY_CONFIG,
  parseSimpleSigningPayload,
  publicKeyId,
  signBlob,
  signingKeyType,
  verifyBlob,
  verifyIndex,
  verifyPackage,
  verifySimpleSigning,
  type DetachedSignature,
  type SigningKeyType,
} from './signing';

// Throwaway keys, generated per run; nothing is committed.
const KEYS: Record<SigningKeyType, ReturnType<typeof generateSigningKeyPair>> = {
  'ecdsa-p256': generateSigningKeyPair('ecdsa-p256'),
  ed25519: generateSigningKeyPair('ed25519'),
};
const OTHER = generateSigningKeyPair('ecdsa-p256');
const DATA = Buffer.from('hello app store');

describe.each(['ecdsa-p256', 'ed25519'] as const)('blob signatures (%s)', (type) => {
  const key = KEYS[type];

  it('round-trips and names the key', () => {
    const signature = signBlob(DATA, key.privateKeyPem);

    expect(verifyBlob(DATA, signature, [key.publicKeyPem])).toEqual({ ok: true, value: { keyId: key.keyId } });
    expect(verifyBlob(DATA, `${signature}\n`, [OTHER.publicKeyPem, key.publicKeyPem])).toEqual({
      ok: true,
      value: { keyId: key.keyId },
    });
  });

  it('detects tampered data and signatures', () => {
    const signature = signBlob(DATA, key.privateKeyPem);
    const raw = Buffer.from(signature, 'base64');

    raw[raw.length - 5] ^= 0x01;

    expect(verifyBlob(Buffer.from('hello app storE'), signature, [key.publicKeyPem]).ok).toBe(false);
    expect(verifyBlob(DATA, raw.toString('base64'), [key.publicKeyPem]).ok).toBe(false);
  });

  it('refuses the wrong key', () => {
    const result = verifyBlob(DATA, signBlob(DATA, key.privateKeyPem), [OTHER.publicKeyPem]);

    expect(result).toEqual({ ok: false, errors: ['the signature does not match any trusted key'] });
  });

  it('reports the key type', () => {
    expect(signingKeyType(key.publicKeyPem)).toBe(type);
  });
});

describe('keys', () => {
  it('key id is the SHA-256 of the SPKI DER', () => {
    const der = createPublicKey(KEYS['ecdsa-p256'].publicKeyPem).export({ type: 'spki', format: 'der' });

    expect(publicKeyId(KEYS['ecdsa-p256'].publicKeyPem)).toBe(createHash('sha256').update(der).digest('hex'));
    expect(publicKeyId(KEYS['ecdsa-p256'].privateKeyPem)).toBe(KEYS['ecdsa-p256'].keyId);
    expect(KEYS.ed25519.keyId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses other key types', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    const rsaPem = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString();

    expect(() => publicKeyId(rsaPem)).toThrow(/ECDSA P-256 or Ed25519/);
    expect(() => signBlob(DATA, p384.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())).toThrow();
    expect(signingKeyType(rsaPem)).toBeNull();
    expect(signingKeyType('not a key')).toBeNull();

    const signature = sign('sha256', DATA, rsa.privateKey).toString('base64');

    expect(verifyBlob(DATA, signature, [rsaPem]).ok).toBe(false);
  });

  it('signs with a passphrase-encrypted key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const encrypted = privateKey
      .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' })
      .toString();
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    expect(verifyBlob(DATA, signBlob(DATA, encrypted, 'pw'), [pem]).ok).toBe(true);
    expect(() => signBlob(DATA, encrypted, 'wrong')).toThrow();
  });

  it('verifies a plain ECDSA SHA-256 DER signature (what cosign sign-blob --key writes)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const signature = sign('sha256', DATA, { key: privateKey, dsaEncoding: 'der' }).toString('base64');

    expect(verifyBlob(DATA, signature, [publicKey.export({ type: 'spki', format: 'pem' }).toString()]).ok).toBe(true);
  });

  it('refuses non-base64 signatures and empty key lists', () => {
    expect(verifyBlob(DATA, 'not base64!', [KEYS.ed25519.publicKeyPem]).ok).toBe(false);
    expect(verifyBlob(DATA, signBlob(DATA, KEYS.ed25519.privateKeyPem), [])).toEqual({
      ok: false,
      errors: ['no public key to verify against'],
    });
    expect(verifyBlob(DATA, signBlob(DATA, KEYS.ed25519.privateKeyPem), ['garbage']).ok).toBe(false);
  });
});

describe('cosign simple signing', () => {
  const digest = `sha256:${'1'.repeat(64)}`;

  it('builds the payload byte-for-byte like cosign', () => {
    expect(
      buildSimpleSigningPayload({ dockerReference: 'ghcr.io/acme/wiki:1.2.0', manifestDigest: digest }).toString(),
    ).toBe(
      `{"critical":{"identity":{"docker-reference":"ghcr.io/acme/wiki"},"image":{"docker-manifest-digest":"${digest}"},"type":"cosign container image signature"},"optional":null}`,
    );
    expect(
      JSON.parse(
        buildSimpleSigningPayload({
          dockerReference: 'oci://r.example.com/a@' + digest,
          manifestDigest: digest,
          optional: { a: 'b' },
        }).toString(),
      ),
    ).toMatchObject({ critical: { identity: { 'docker-reference': 'r.example.com/a' } }, optional: { a: 'b' } });
    expect(() => buildSimpleSigningPayload({ dockerReference: 'x', manifestDigest: 'sha256:short' })).toThrow();
  });

  it.each(['ecdsa-p256', 'ed25519'] as const)('signs and verifies (%s)', (type) => {
    const payload = buildSimpleSigningPayload({
      dockerReference: 'r.example.com:5000/apps/wiki',
      manifestDigest: digest,
    });
    const signature = signBlob(payload, KEYS[type].privateKeyPem);
    const result = verifySimpleSigning(payload, signature, [KEYS[type].publicKeyPem], {
      manifestDigest: digest,
      dockerReference: 'r.example.com:5000/apps/wiki:1.2.0',
    });

    expect(result.ok && result.value.keyId).toBe(KEYS[type].keyId);
    expect(result.ok && result.value.payload.critical.image['docker-manifest-digest']).toBe(digest);
  });

  it('refuses another digest, another repository, a tampered payload or the wrong key', () => {
    const payload = buildSimpleSigningPayload({ dockerReference: 'r.example.com/apps/wiki', manifestDigest: digest });
    const signature = signBlob(payload, KEYS.ed25519.privateKeyPem);
    const keys = [KEYS.ed25519.publicKeyPem];

    expect(verifySimpleSigning(payload, signature, keys, { manifestDigest: `sha256:${'2'.repeat(64)}` }).ok).toBe(
      false,
    );
    expect(
      verifySimpleSigning(payload, signature, keys, {
        manifestDigest: digest,
        dockerReference: 'r.example.com/apps/evil',
      }).ok,
    ).toBe(false);
    expect(
      verifySimpleSigning(Buffer.from(payload.toString().replace('wiki', 'wikx')), signature, keys, {
        manifestDigest: digest,
      }).ok,
    ).toBe(false);
    expect(verifySimpleSigning(payload, signature, [OTHER.publicKeyPem], { manifestDigest: digest }).ok).toBe(false);
  });

  it('parses only simple-signing payloads', () => {
    expect(parseSimpleSigningPayload(Buffer.from('{')).ok).toBe(false);
    expect(parseSimpleSigningPayload(Buffer.from('{"critical":{"type":"other"}}')).ok).toBe(false);
  });

  it('names the signature tag', () => {
    expect(cosignSignatureTag(digest)).toBe(`sha256-${'1'.repeat(64)}.sig`);
  });

  it('builds OCI artifact manifests', () => {
    const layer = Buffer.from('layer');
    const { manifest, digest: manifestDigest } = buildOciArtifactManifest({
      layer,
      layerMediaType: APP_PACKAGE_MEDIA_TYPE,
      artifactType: 'application/vnd.loadweaver.app.v1',
    });

    expect(OCI_EMPTY_CONFIG.digest).toBe(sha256Digest('{}'));
    expect(manifestDigest).toBe(sha256Digest(manifest));
    expect(findOciLayer(manifest, APP_PACKAGE_MEDIA_TYPE)).toEqual({ digest: sha256Digest(layer), size: 5 });
    expect(findOciLayer(manifest, 'other')).toBeUndefined();
    expect(findOciLayer(Buffer.from('nope'), 'other')).toBeUndefined();
  });
});

describe('index and package verification', () => {
  const catalogKey = generateSigningKeyPair('ecdsa-p256');
  const publisherKey = generateSigningKeyPair('ed25519');
  const archive = buildPackageArchive({ compose: COMPOSE_YAML, manifest: MANIFEST_YAML, readme: README });

  function indexDoc(
    publishers: Record<string, unknown> = {
      [publisherKey.keyId]: { name: 'acme', publicKey: publisherKey.publicKeyPem, label: 'verified' },
    },
  ): Buffer {
    return Buffer.from(
      stringify({
        apiVersion: 'apps.loadweaver.com/v1',
        kind: 'CatalogIndex',
        catalog: { name: 'community', title: 'Community', trust: 'community' },
        publishers,
        apps: [
          {
            name: 'wiki',
            title: 'Wiki',
            summary: 'A wiki',
            publisher: 'acme',
            trust: 'verified',
            versions: [
              { version: '1.2.0', channel: 'stable', digest: sha256Digest(archive), published: '2026-10-31T00:00:00Z' },
            ],
          },
        ],
        takedowns: [],
        generatedAt: '2026-10-31T00:00:00Z',
      }),
    );
  }

  function ociSignature(
    content: Buffer,
    mediaType: string,
    key: string,
    reference = 'r.example.com/apps/wiki',
  ): DetachedSignature {
    const { manifest, digest } = buildOciArtifactManifest({ layer: content, layerMediaType: mediaType });
    const payload = buildSimpleSigningPayload({ dockerReference: reference, manifestDigest: digest });

    return { kind: 'oci', manifest, payload, signature: signBlob(payload, key), dockerReference: reference };
  }

  function verifiedIndex() {
    const bytes = indexDoc();
    const result = verifyIndex(bytes, { kind: 'blob', signature: signBlob(bytes, catalogKey.privateKeyPem) }, [
      catalogKey.publicKeyPem,
    ]);

    if (!result.ok) throw new Error(result.errors.join('\n'));

    return result.value.index;
  }

  it('verifies and parses a blob-signed index', () => {
    const bytes = indexDoc();
    const result = verifyIndex(bytes, { kind: 'blob', signature: signBlob(bytes, catalogKey.privateKeyPem) }, [
      catalogKey.publicKeyPem,
    ]);

    expect(result.ok && result.value.keyId).toBe(catalogKey.keyId);
    expect(result.ok && result.value.index.apps[0].name).toBe('wiki');
  });

  it('verifies an OCI-signed index', () => {
    const bytes = indexDoc();

    expect(
      verifyIndex(bytes, ociSignature(bytes, APP_INDEX_MEDIA_TYPE, catalogKey.privateKeyPem, 'r.example.com/apps'), [
        catalogKey.publicKeyPem,
      ]).ok,
    ).toBe(true);
  });

  it('refuses a tampered index or the wrong catalog key', () => {
    const bytes = indexDoc();
    const signature: DetachedSignature = { kind: 'blob', signature: signBlob(bytes, catalogKey.privateKeyPem) };
    const tampered = Buffer.from(bytes.toString().replace('trust: verified', 'trust: community'));

    expect(verifyIndex(tampered, signature, [catalogKey.publicKeyPem]).ok).toBe(false);
    expect(verifyIndex(bytes, signature, [publisherKey.publicKeyPem]).ok).toBe(false);
  });

  it('refuses publisher entries whose key does not match the key id', () => {
    const bytes = indexDoc({
      ['f'.repeat(64)]: { name: 'acme', publicKey: publisherKey.publicKeyPem, label: 'verified' },
    });
    const result = verifyIndex(bytes, { kind: 'blob', signature: signBlob(bytes, catalogKey.privateKeyPem) }, [
      catalogKey.publicKeyPem,
    ]);

    expect(!result.ok && result.errors[0]).toMatch(/the public key's id is/);
  });

  it('verifies a blob-signed package against its publisher key', () => {
    const result = verifyPackage({
      index: verifiedIndex(),
      app: 'wiki',
      version: '1.2.0',
      archive,
      signature: { kind: 'blob', signature: signBlob(archive, publisherKey.privateKeyPem) },
    });

    expect(result.ok && result.value).toMatchObject({ keyId: publisherKey.keyId, publisher: 'acme' });
  });

  it('verifies an OCI-signed package', () => {
    const result = verifyPackage({
      index: verifiedIndex(),
      app: 'wiki',
      version: '1.2.0',
      archive,
      signature: ociSignature(archive, APP_PACKAGE_MEDIA_TYPE, publisherKey.privateKeyPem),
    });

    expect(result.ok).toBe(true);
  });

  it('refuses a package signed by another key (even the catalog key)', () => {
    const result = verifyPackage({
      index: verifiedIndex(),
      app: 'wiki',
      version: '1.2.0',
      archive,
      signature: { kind: 'blob', signature: signBlob(archive, catalogKey.privateKeyPem) },
    });

    expect(!result.ok && result.errors).toEqual(['wiki 1.2.0: the signature does not match any trusted key']);
  });

  it('refuses a package whose bytes differ from the index digest', () => {
    const other = buildPackageArchive({ compose: COMPOSE_YAML, manifest: MANIFEST_YAML, readme: 'changed' });
    const result = verifyPackage({
      index: verifiedIndex(),
      app: 'wiki',
      version: '1.2.0',
      archive: other,
      signature: { kind: 'blob', signature: signBlob(other, publisherKey.privateKeyPem) },
    });

    expect(!result.ok && result.errors[0]).toMatch(/does not match the index/);
  });

  it('refuses unknown versions and OCI manifests for other content', () => {
    const index = verifiedIndex();
    const signature = { kind: 'blob' as const, signature: signBlob(archive, publisherKey.privateKeyPem) };

    expect(verifyPackage({ index, app: 'wiki', version: '9.9.9', archive, signature }).ok).toBe(false);

    const forOther = ociSignature(Buffer.from('other'), APP_PACKAGE_MEDIA_TYPE, publisherKey.privateKeyPem);
    const result = verifyPackage({ index, app: 'wiki', version: '1.2.0', archive, signature: forOther });

    expect(!result.ok && result.errors[0]).toMatch(/layer .* is not the content/);

    const wrongType = ociSignature(archive, 'application/octet-stream', publisherKey.privateKeyPem);

    expect(verifyPackage({ index, app: 'wiki', version: '1.2.0', archive, signature: wrongType }).ok).toBe(false);
  });

  it('refuses an OCI signature for another manifest (swapped payload)', () => {
    const real = ociSignature(archive, APP_PACKAGE_MEDIA_TYPE, publisherKey.privateKeyPem);
    const otherPayload = buildSimpleSigningPayload({
      dockerReference: 'r.example.com/apps/wiki',
      manifestDigest: `sha256:${'3'.repeat(64)}`,
    });
    const swapped: DetachedSignature = {
      ...(real as Extract<DetachedSignature, { kind: 'oci' }>),
      payload: otherPayload,
      signature: signBlob(otherPayload, publisherKey.privateKeyPem),
    };

    expect(
      verifyPackage({ index: verifiedIndex(), app: 'wiki', version: '1.2.0', archive, signature: swapped }).ok,
    ).toBe(false);
  });
});
