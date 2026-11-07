import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJson } from './canonical-json';
import { listFilesRecursive, sha256File } from './file-digest';
import {
  checkReleaseFiles,
  createProductReleaseManifest,
  productReleaseManifestBytes,
  verifyProductReleaseManifest,
  type ProductReleaseManifestInput,
} from './product-manifest';
import { generateReleaseKeyPair, releaseKeyId, signManifest, verifyManifestSignature } from './signature';
import { resolveTrustedReleaseKeys, splitPublicKeyPems } from './trusted-keys';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const COMMIT = 'b'.repeat(40);

describe('canonical JSON', () => {
  it('sorts keys, drops undefined and refuses non-JSON values', () => {
    expect(canonicalJson({ b: 1, a: [true, null, { d: 'x', c: undefined }] })).toBe(
      '{"a":[true,null,{"d":"x"}],"b":1}',
    );
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: BigInt(1) })).toThrow();
  });
});

describe('release signatures', () => {
  const pair = generateReleaseKeyPair();
  const other = generateReleaseKeyPair();
  const data = Buffer.from('{"a":1}');

  it('signs with ECDSA P-256 and verifies with a trusted key only', () => {
    const signature = signManifest(data, pair.privateKeyPem);

    expect(signature.keyId).toBe(pair.keyId);
    expect(releaseKeyId(pair.publicKeyPem)).toBe(pair.keyId);
    expect(verifyManifestSignature(data, signature, [other.publicKeyPem, pair.publicKeyPem])).toEqual({
      ok: true,
      keyId: pair.keyId,
    });
    expect(verifyManifestSignature(data, signature, [other.publicKeyPem]).ok).toBe(false);
    expect(verifyManifestSignature(Buffer.from('{"a":2}'), signature, [pair.publicKeyPem]).ok).toBe(false);
    expect(verifyManifestSignature(data, { algorithm: 'rsa' }, [pair.publicKeyPem])).toEqual({
      ok: false,
      reason: 'the signature document is malformed',
    });
    expect(verifyManifestSignature(data, signature, [])).toEqual({
      ok: false,
      reason: 'no release signing key is trusted by this build',
    });
  });

  it('refuses keys that are not P-256', () => {
    const { generateKeyPairSync } = jest.requireActual<typeof import('node:crypto')>('node:crypto');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });

    expect(() => signManifest(data, rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())).toThrow();
    expect(() => releaseKeyId(rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString())).toThrow();
  });
});

describe('trusted keys', () => {
  const pair = generateReleaseKeyPair();
  const other = generateReleaseKeyPair();

  it('adds development keys only outside production and fails on malformed keys', () => {
    const env = { NODE_ENV: 'test', X_DEV_KEYS: `${pair.publicKeyPem}\n${other.publicKeyPem}` };

    expect(splitPublicKeyPems(env.X_DEV_KEYS)).toHaveLength(2);
    expect(resolveTrustedReleaseKeys({ compiled: [], devKeysEnv: 'X_DEV_KEYS', env })).toEqual([
      pair.publicKeyPem.trim(),
      other.publicKeyPem.trim(),
    ]);
    expect(
      resolveTrustedReleaseKeys({
        compiled: [pair.publicKeyPem],
        devKeysEnv: 'X_DEV_KEYS',
        env: { ...env, NODE_ENV: 'production' },
      }),
    ).toEqual([pair.publicKeyPem]);
    expect(resolveTrustedReleaseKeys({ compiled: [], env })).toEqual([]);
    expect(() =>
      resolveTrustedReleaseKeys({ compiled: ['-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'] }),
    ).toThrow();
  });
});

describe('product release manifests', () => {
  const pair = generateReleaseKeyPair();
  const input: ProductReleaseManifestInput = {
    product: 'agenstra',
    version: '3.5.0',
    source: { repository: 'forepath/one', commit: COMMIT },
    images: [
      { name: 'manager-api', repository: 'ghcr.io/forepath/agenstra-manager-api', tag: '3.5.0', digest: DIGEST },
      { name: 'controller-api', repository: 'ghcr.io/forepath/agenstra-controller-api', digest: DIGEST },
    ],
    files: [{ path: 'desktop/Agenstra Agent Console-1.zip', sha256: 'c'.repeat(64), size: 3 }],
  };

  it('sorts entries, derives the channel and refuses duplicates and unsafe values', () => {
    const manifest = createProductReleaseManifest(input);

    expect(manifest.images.map((i) => i.name)).toEqual(['controller-api', 'manager-api']);
    expect(manifest.channel).toBe('stable');
    expect(createProductReleaseManifest({ ...input, version: '3.6.0-beta.1' }).channel).toBe('beta');
    expect(() => createProductReleaseManifest({ ...input, images: [input.images[0], input.images[0]] })).toThrow(
      /duplicate image/,
    );

    for (const path of ['../x', '/etc/passwd', 'a/./b', 'a\\b', 'a//b', 'a\nb'])
      expect(() =>
        createProductReleaseManifest({ ...input, files: [{ path, sha256: 'c'.repeat(64), size: 1 }] }),
      ).toThrow();

    expect(() =>
      createProductReleaseManifest({ ...input, images: [{ ...input.images[0], digest: 'latest' }] }),
    ).toThrow();
    expect(() => createProductReleaseManifest({ ...input, version: 'v3.5.0' })).toThrow();
  });

  it('verifies the canonical bytes, the product and the signature', () => {
    const bytes = productReleaseManifestBytes(createProductReleaseManifest(input));
    const signature = signManifest(bytes, pair.privateKeyPem);
    const ok = verifyProductReleaseManifest(bytes, signature, [pair.publicKeyPem], 'agenstra');

    expect(ok.ok && ok.manifest.version).toBe('3.5.0');
    expect(ok.ok && ok.keyId).toBe(pair.keyId);
    expect(verifyProductReleaseManifest(bytes, signature, [pair.publicKeyPem], 'decabill')).toEqual({
      ok: false,
      reason: 'the manifest is for agenstra, not decabill',
    });
    expect(verifyProductReleaseManifest(bytes, signature, [], 'agenstra').ok).toBe(false);

    const pretty = Buffer.from(JSON.stringify(JSON.parse(bytes.toString()), null, 2));

    expect(verifyProductReleaseManifest(pretty, signature, [pair.publicKeyPem], 'agenstra')).toEqual({
      ok: false,
      reason: 'the manifest is not in canonical form',
    });

    const tampered = Buffer.from(bytes.toString().replace('3.5.0', '3.5.1'));

    expect(verifyProductReleaseManifest(tampered, signature, [pair.publicKeyPem], 'agenstra').ok).toBe(false);
  });

  it('keeps unknown top-level fields of newer manifests under the signature', () => {
    const bytes = Buffer.from(canonicalJson({ ...createProductReleaseManifest(input), sbom: 'x' }));
    const result = verifyProductReleaseManifest(
      bytes,
      signManifest(bytes, pair.privateKeyPem),
      [pair.publicKeyPem],
      'agenstra',
    );

    expect(result.ok).toBe(true);
  });
});

describe('release files', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'release-signing-'));
    mkdirSync(join(root, 'desktop'));
    writeFileSync(join(root, 'desktop', 'a.zip'), 'abc');
    writeFileSync(join(root, 'desktop', 'b.zip'), 'xyz');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('hashes, lists and checks files laid out as in the manifest', async () => {
    const a = await sha256File(join(root, 'desktop', 'a.zip'));

    expect(a).toEqual({ sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', size: 3 });
    expect(await listFilesRecursive(root)).toEqual(['desktop/a.zip', 'desktop/b.zip']);
    expect(
      await checkReleaseFiles(
        [
          { path: 'desktop/a.zip', ...a },
          { path: 'desktop/b.zip', ...a },
          { path: 'desktop/c.zip', ...a },
        ],
        root,
      ),
    ).toEqual([
      { path: 'desktop/a.zip', status: 'ok' },
      { path: 'desktop/b.zip', status: 'mismatch' },
      { path: 'desktop/c.zip', status: 'missing' },
    ]);
  });
});
