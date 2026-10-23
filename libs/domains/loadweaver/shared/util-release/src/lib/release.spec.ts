import { createHash } from 'node:crypto';

import { RELEASE_SIGNING_KEYS } from '@forepath/shared/shared/util-release-keys';

import { BundleError, MANIFEST_ENTRY, parseManifest, readBundle, SIGNATURE_ENTRY, verifyManifest } from './bundle';
import { canonicalJson } from './canonical-json';
import {
  CONSOLE_IMAGE_REPOSITORY,
  imageComponents,
  imageReference,
  missingComponents,
  packagePins,
  type ArtifactFile,
} from './manifest';
import { COMPONENT_IMAGES, splitImageReference } from './pins';
import { trustedReleaseKeys, unsignedBundlesAllowed, unsignedBundlesNotice } from './bundle-trust';
import { generateReleaseKeyPair, releaseKeyId, signManifest, verifyManifestSignature } from './signature';
import { buildManifest } from './source-manifest';
import { buildTar, readAll, readTar, tarHeader, tarPadding, TAR_END } from './tar';
import { compareVersions, isPrerelease, normalizeVersion, updateKind, withinOneMinor } from './versions';

const CP = `ghcr.io/forepath/loadweaver-control-plane-api:3.5.0@sha256:${'c'.repeat(64)}`;

function file(path: string, data: Buffer): ArtifactFile {
  return { path, sha256: createHash('sha256').update(data).digest('hex'), size: data.length };
}

async function* chunks(buffer: Buffer, size = 700): AsyncGenerator<Buffer> {
  for (let i = 0; i < buffer.length; i += size) yield buffer.subarray(i, i + size);
}

const AGENT = Buffer.from('#!agent binary\n'.repeat(100));
const GVISOR = Buffer.from('gvisor tarball');

function manifestFor(version = '3.5.0') {
  return buildManifest({
    version,
    channel: isPrerelease(version) ? 'beta' : 'stable',
    created: '2026-10-19T00:00:00.000Z',
    images: { 'control-plane': CP },
    agentBinaries: { amd64: file('artifacts/bin/loadweaver-agent-linux-amd64', AGENT) },
    gvisorTarballs: { amd64: file('artifacts/gvisor/amd64/gvisor.tar.bz2', GVISOR) },
    notes: ['Requires agents ≥ 3.4'],
  });
}

function bundle(
  options: {
    version?: string;
    key?: string | null;
    signature?: unknown;
    order?: 'normal' | 'sig-late';
    tamper?: boolean;
    extra?: boolean;
    skipAgent?: boolean;
  } = {},
) {
  const manifest = manifestFor(options.version);
  const bytes = Buffer.from(canonicalJson(manifest));
  const signature =
    options.signature !== undefined ? options.signature : options.key ? signManifest(bytes, options.key) : null;
  const entries: { name: string; data: Buffer }[] = [{ name: MANIFEST_ENTRY, data: bytes }];

  if (signature !== null) entries.push({ name: SIGNATURE_ENTRY, data: Buffer.from(JSON.stringify(signature)) });

  if (!options.skipAgent)
    entries.push({
      name: 'artifacts/bin/loadweaver-agent-linux-amd64',
      data: options.tamper ? Buffer.from(AGENT.toString().replace('agent', 'evil!')) : AGENT,
    });

  entries.push({ name: 'artifacts/gvisor/amd64/gvisor.tar.bz2', data: GVISOR });

  if (options.extra) entries.push({ name: 'artifacts/unlisted.bin', data: Buffer.from('x') });

  return { manifest, tar: buildTar(entries) };
}

describe('release versions', () => {
  it('orders versions and prereleases like semver', () => {
    expect(compareVersions('3.5.0', 'v3.5.0')).toBe(0);
    expect(compareVersions('3.5.0', '3.10.0')).toBe(-1);
    expect(compareVersions('3.6.0-beta.2', '3.6.0-beta.10')).toBe(-1);
    expect(compareVersions('3.6.0-beta.1', '3.6.0')).toBe(-1);
    expect(compareVersions('3.6.0-alpha', '3.6.0-1')).toBe(1);
    expect(() => compareVersions('3.5', '3.5.0')).toThrow();
    expect(normalizeVersion('v3.5.0')).toBe('3.5.0');
    expect(normalizeVersion('main')).toBeNull();
    expect(isPrerelease('3.6.0-beta.1')).toBe(true);
  });

  it('classifies updates and the N-1 window', () => {
    expect(updateKind('3.5.0', '3.5.2')).toBe('patch');
    expect(updateKind('3.5.2', '3.6.0')).toBe('minor');
    expect(updateKind('3.5.2', '4.0.0')).toBe('major');
    expect(updateKind('3.5.2', '3.5.1')).toBe('downgrade');
    expect(updateKind('3.5.2', '3.5.2')).toBe('none');
    expect(withinOneMinor('3.4.9', '3.5.0')).toBe(true);
    expect(withinOneMinor('3.3.0', '3.5.0')).toBe(false);
    expect(withinOneMinor('3.9.0', '4.0.0')).toBe(false);
    expect(withinOneMinor('3.6.0', '3.5.0')).toBe(true);
    expect(withinOneMinor('0.0.0-dev', 'garbage')).toBe(true);
  });
});

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

  it('signs with ECDSA P-256 and verifies with the trusted key only', () => {
    const signature = signManifest(data, pair.privateKeyPem);

    expect(signature.keyId).toBe(pair.keyId);
    expect(releaseKeyId(pair.publicKeyPem)).toBe(pair.keyId);
    expect(verifyManifestSignature(data, signature, [other.publicKeyPem, pair.publicKeyPem])).toEqual({
      ok: true,
      keyId: pair.keyId,
    });
    expect(verifyManifestSignature(data, signature, [other.publicKeyPem]).ok).toBe(false);
    expect(verifyManifestSignature(Buffer.from('{"a":2}'), signature, [pair.publicKeyPem]).ok).toBe(false);
    expect(verifyManifestSignature(data, { ...signature, signature: 'AAAA' }, [pair.publicKeyPem]).ok).toBe(false);
    expect(verifyManifestSignature(data, { algorithm: 'rsa' }, [pair.publicKeyPem])).toEqual({
      ok: false,
      reason: 'the signature document is malformed',
    });
    expect(verifyManifestSignature(data, signature, []).ok).toBe(false);
  });

  it('refuses keys that are not P-256', () => {
    const { generateKeyPairSync } = jest.requireActual<typeof import('node:crypto')>('node:crypto');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });

    expect(() => signManifest(data, rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())).toThrow();
    expect(() => releaseKeyId(rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString())).toThrow();
  });

  it('trusts development keys and unsigned bundles only on explicit opt-in outside production', () => {
    // The compiled-in release key always; development keys only outside production.
    expect(trustedReleaseKeys({ NODE_ENV: 'test', LOADWEAVER_RELEASE_DEV_KEYS: pair.publicKeyPem })).toEqual([
      ...RELEASE_SIGNING_KEYS.loadweaver,
      pair.publicKeyPem.trim(),
    ]);
    expect(trustedReleaseKeys({ NODE_ENV: 'production', LOADWEAVER_RELEASE_DEV_KEYS: pair.publicKeyPem })).toEqual([
      ...RELEASE_SIGNING_KEYS.loadweaver,
    ]);
    expect(RELEASE_SIGNING_KEYS.loadweaver).toHaveLength(1);
    expect(unsignedBundlesAllowed({})).toBe(false);
    expect(unsignedBundlesAllowed({ LOADWEAVER_ALLOW_UNSIGNED_BUNDLES: 'true' })).toBe(true);
    expect(unsignedBundlesNotice({})).toBeNull();
  });

  it('refuses unsigned bundles in production without the second opt-in (M6 review L1)', () => {
    const prod = { NODE_ENV: 'production', LOADWEAVER_ALLOW_UNSIGNED_BUNDLES: 'true' };

    expect(unsignedBundlesAllowed(prod)).toBe(false);
    expect(unsignedBundlesNotice(prod)).toContain('is ignored with NODE_ENV=production');
    expect(unsignedBundlesAllowed({ ...prod, LOADWEAVER_ALLOW_UNSIGNED_BUNDLES_IN_PRODUCTION: 'yes' })).toBe(false);
    expect(unsignedBundlesAllowed({ ...prod, LOADWEAVER_ALLOW_UNSIGNED_BUNDLES_IN_PRODUCTION: 'i-understand' })).toBe(
      true,
    );
    expect(
      unsignedBundlesNotice({ ...prod, LOADWEAVER_ALLOW_UNSIGNED_BUNDLES_IN_PRODUCTION: 'i-understand' }),
    ).toContain('UNSIGNED release bundles are accepted IN PRODUCTION');
  });
});

describe('release manifests', () => {
  it('builds a complete manifest from the source pins', () => {
    const manifest = manifestFor();

    expect(missingComponents(manifest)).toEqual([]);
    expect(imageReference(imageComponents(manifest)['control-plane'])).toBe(CP);
    expect(imageReference(imageComponents(manifest)['envoy'])).toBe(COMPONENT_IMAGES.envoy);
    expect(manifest.artifacts.map((a) => a.path)).toEqual([
      'artifacts/bin/loadweaver-agent-linux-amd64',
      'artifacts/gvisor/amd64/gvisor.tar.bz2',
    ]);
    expect(packagePins(manifest, 'debian:13')).toMatchObject({ 'drbd-utils': '9.22.0-1.1', bird2: '2.17.5-0+deb13u1' });
    expect(packagePins(manifest, 'ubuntu:22.04')).toMatchObject({ 'drbd-utils': '9.15.0-1ubuntu0.1' });
  });

  it('pins the console image by digest at the top level, outside the cluster components (Loadweaver Cloud)', () => {
    const digest = `sha256:${'d'.repeat(64)}`;
    const manifest = buildManifest({
      version: '3.5.0',
      channel: 'stable',
      created: '2026-10-19T00:00:00.000Z',
      images: { 'control-plane': CP },
      consoleImage: `${CONSOLE_IMAGE_REPOSITORY}:3.5.0@${digest}`,
      agentBinaries: {},
    });

    expect(manifest.consoleImage).toEqual({ repository: CONSOLE_IMAGE_REPOSITORY, tag: '3.5.0', digest });
    expect(imageComponents(manifest)['console']).toBeUndefined();
    expect(parseManifest(Buffer.from(canonicalJson(manifest))).consoleImage?.digest).toBe(digest);
    // Bundles without it stay valid (older releases, development bundles).
    expect(manifestFor().consoleImage).toBeUndefined();

    const base = {
      version: '3.5.0',
      channel: 'stable' as const,
      created: '2026-10-19T00:00:00.000Z',
      agentBinaries: {},
    };

    expect(() =>
      buildManifest({ ...base, images: { 'control-plane': CP }, consoleImage: `${CONSOLE_IMAGE_REPOSITORY}:3.5.0` }),
    ).toThrow(/console image .* not pinned by digest/);
    expect(() =>
      buildManifest({ ...base, images: { 'control-plane': CP }, consoleImage: `ghcr.io/evil/console@${digest}` }),
    ).toThrow(/must come from/);
    expect(() =>
      parseManifest(
        Buffer.from(
          canonicalJson({ ...manifest, consoleImage: { repository: CONSOLE_IMAGE_REPOSITORY, digest: 'x' } }),
        ),
      ),
    ).toThrow(/invalid image digest/);
  });

  it('pins the release-built microVM launcher when given, and leaves it out of development manifests', () => {
    const launcher = `ghcr.io/forepath/microvm-launcher:3.5.0@sha256:${'e'.repeat(64)}`;
    const base = {
      version: '3.5.0',
      channel: 'stable' as const,
      created: '2026-10-19T00:00:00.000Z',
      agentBinaries: {},
    };

    expect(imageComponents(manifestFor())['microvm-launcher']).toBeUndefined();
    expect(missingComponents(manifestFor())).toEqual([]);

    const manifest = buildManifest({ ...base, images: { 'control-plane': CP, 'microvm-launcher': launcher } });

    expect(imageReference(imageComponents(manifest)['microvm-launcher'])).toBe(launcher);
    expect(imageComponents(manifest)['microvm-launcher'].version).toBe('3.5.0');
    expect(() =>
      buildManifest({
        ...base,
        images: { 'control-plane': CP, 'microvm-launcher': 'ghcr.io/forepath/microvm-launcher:3.5.0' },
      }),
    ).toThrow(/microvm-launcher .* not pinned by digest/);
  });

  it('refuses images without a digest', () => {
    expect(() =>
      buildManifest({
        version: '3.5.0',
        channel: 'stable',
        created: '2026-10-19T00:00:00.000Z',
        agentBinaries: {},
      }),
    ).toThrow(/control-plane .* not pinned by digest/);
    expect(splitImageReference('a/b:1@sha256:x')).toEqual({ repository: 'a/b', tag: '1', digest: 'sha256:x' });
    expect(splitImageReference('localhost:5000/b@sha256:x')).toEqual({
      repository: 'localhost:5000/b',
      digest: 'sha256:x',
    });
    expect(splitImageReference('a/b:1')).toBeNull();
  });

  it('accepts only canonical, complete manifests and ignores unknown additions', () => {
    const manifest = manifestFor();
    const text = canonicalJson(manifest);

    expect(parseManifest(Buffer.from(text)).version).toBe('3.5.0');
    expect(() => parseManifest(Buffer.from(JSON.stringify(manifest, null, 2)))).toThrow(/canonical/);
    expect(() => parseManifest(Buffer.from('nope'))).toThrow(/not JSON/);

    // A newer release adds a field and a component kind: still readable.
    const newer = {
      ...manifest,
      future: { x: 1 },
      components: { ...manifest.components, wasm: { kind: 'plugin', version: '1' } },
    };

    expect(parseManifest(Buffer.from(canonicalJson(newer))).components['wasm']).toMatchObject({ kind: 'plugin' });

    // Unlisted references and missing core components are refused.
    const unlisted = { ...manifest, artifacts: [] };

    expect(() => parseManifest(Buffer.from(canonicalJson(unlisted)))).toThrow(/referenced but not listed/);

    const rest = { ...manifest.components };

    delete rest['etcd'];

    const incomplete = { ...manifest, components: rest };

    expect(() => parseManifest(Buffer.from(canonicalJson(incomplete)))).toThrow(/etcd is missing/);
    expect(() => parseManifest(Buffer.from(canonicalJson({ ...manifest, version: '../x' })))).toThrow(/invalid/);
  });
});

describe('tar', () => {
  it('round-trips files with long names in small chunks', async () => {
    const long = `artifacts/${'d'.repeat(90)}/${'f'.repeat(90)}.bin`;
    const tar = buildTar([
      { name: 'a.txt', data: 'hello' },
      { name: long, data: Buffer.alloc(1500, 7) },
      { name: 'empty', data: '' },
    ]);
    const seen: { name: string; size: number; data: Buffer }[] = [];

    for await (const entry of readTar(chunks(tar, 333)))
      seen.push({ name: entry.name, size: entry.size, data: await readAll(entry.body, 1e6) });

    expect(seen.map((s) => [s.name, s.size])).toEqual([
      ['a.txt', 5],
      [long, 1500],
      ['empty', 0],
    ]);
    expect(seen[1].data.equals(Buffer.alloc(1500, 7))).toBe(true);
  });

  it('skips unread bodies', async () => {
    const tar = buildTar([
      { name: 'a', data: Buffer.alloc(2000, 1) },
      { name: 'b', data: 'b' },
    ]);
    const names: string[] = [];

    for await (const entry of readTar(chunks(tar))) names.push(entry.name);

    expect(names).toEqual(['a', 'b']);
  });

  it('refuses links, unsafe names, bad checksums, truncation and oversized entries', async () => {
    const drain = async (buffer: Buffer, max?: number) => {
      for await (const entry of readTar(chunks(buffer), { maxEntryBytes: max })) await readAll(entry.body, 1e7);
    };
    const link = tarHeader('evil', 0);

    link[156] = '2'.charCodeAt(0);
    // Recompute the checksum for the modified type flag.
    link.fill(0x20, 148, 156);

    let sum = 0;

    for (const b of link) sum += b;

    link.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');

    await expect(drain(Buffer.concat([link, TAR_END]))).rejects.toThrow(/not a regular file/);
    expect(() => tarHeader('../etc/passwd', 1)).toThrow(/unsafe/);
    expect(() => tarHeader('/abs', 1)).toThrow(/unsafe/);

    const corrupt = buildTar([{ name: 'a', data: 'x' }]);

    corrupt[0] = 'b'.charCodeAt(0);
    await expect(drain(corrupt)).rejects.toThrow(/checksum/);

    const full = buildTar([{ name: 'a', data: Buffer.alloc(3000) }]);

    await expect(drain(full.subarray(0, 1024))).rejects.toThrow(/truncated/);
    await expect(drain(Buffer.concat([tarHeader('a', 1), Buffer.from('x'), tarPadding(1)]))).rejects.toThrow(
      /end-of-archive/,
    );
    await expect(drain(full, 100)).rejects.toThrow(/size limit/);
  });
});

describe('bundles', () => {
  const key = generateReleaseKeyPair();
  const trustedKeys = [key.publicKeyPem];

  async function read(tar: Buffer, options: { allowUnsigned?: boolean; maxBytes?: number } = {}) {
    const stored = new Map<string, Buffer>();
    let manifestSeen = false;
    const result = await readBundle(chunks(tar, 1000), {
      trustedKeys,
      allowUnsigned: options.allowUnsigned ?? false,
      maxBytes: options.maxBytes ?? 1e8,
      onManifest: () => {
        manifestSeen = true;
      },
      onArtifact: async (f, body) => {
        expect(manifestSeen).toBe(true);
        stored.set(f.path, await readAll(body, 1e8));
      },
    });

    return { result, stored };
  }

  it('reads a signed bundle and verifies every artifact', async () => {
    const { tar } = bundle({ key: key.privateKeyPem });
    const { result, stored } = await read(tar);

    expect(result.keyId).toBe(key.keyId);
    expect(result.manifest.version).toBe('3.5.0');
    expect(stored.get('artifacts/bin/loadweaver-agent-linux-amd64')?.equals(AGENT)).toBe(true);
  });

  it('refuses a bad signature before any artifact is read', async () => {
    const forger = generateReleaseKeyPair();
    const { tar } = bundle({ key: forger.privateKeyPem });
    const onArtifact = jest.fn();

    await expect(
      readBundle(chunks(tar), { trustedKeys, allowUnsigned: true, maxBytes: 1e8, onArtifact }),
    ).rejects.toMatchObject({ kind: 'signature' });
    expect(onArtifact).not.toHaveBeenCalled();
  });

  it('accepts unsigned bundles only when allowed', async () => {
    await expect(read(bundle({ key: null }).tar)).rejects.toThrow(/not signed/);
    await expect(read(bundle({ signature: { algorithm: 'none' } }).tar)).rejects.toThrow(/not signed/);
    expect((await read(bundle({ key: null }).tar, { allowUnsigned: true })).result.keyId).toBeNull();
  });

  it('refuses tampered, unlisted, missing and oversized content', async () => {
    await expect(read(bundle({ key: key.privateKeyPem, tamper: true }).tar)).rejects.toThrow(/SHA-256/);
    await expect(read(bundle({ key: key.privateKeyPem, extra: true }).tar)).rejects.toThrow(/unexpected file/);
    await expect(read(bundle({ key: key.privateKeyPem, skipAgent: true }).tar)).rejects.toThrow(/lacks/);
    await expect(read(bundle({ key: key.privateKeyPem }).tar, { maxBytes: 2000 })).rejects.toMatchObject({
      kind: 'size',
    });

    const sigFirst = buildTar([{ name: SIGNATURE_ENTRY, data: '{}' }]);

    await expect(read(sigFirst)).rejects.toThrow(/directly follow/);
  });

  it('verifies a manifest + signature pair outside a bundle (agents)', () => {
    const { manifest } = bundle();
    const bytes = Buffer.from(canonicalJson(manifest));

    expect(
      verifyManifest(bytes, signManifest(bytes, key.privateKeyPem), { trustedKeys, allowUnsigned: false }).keyId,
    ).toBe(key.keyId);
    expect(() => verifyManifest(bytes, null, { trustedKeys, allowUnsigned: false })).toThrow(BundleError);
  });
});
